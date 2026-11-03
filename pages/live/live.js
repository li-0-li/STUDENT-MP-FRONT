// 实时课堂（2026-10-29 改版：删投屏/直播/课堂互动，保留在线人数；新增导航「课堂/随堂测试」）
// 结构：课堂状态卡 → 导航（课堂 | 随堂测试[红点]）
//   课堂 tab：在线人数 + 签到按钮（教师发布签到显红点；五种方式）+ 花名册（只读，10s 轮询自动刷新）
//   随堂测试 tab：当前测试信息 + 开始测试；未发布时空态 + 查看历史测试
// 接入：
//   current 当前课堂发现（GET /sessions/current）→ 按学生选课解析「现在该上哪节课」
//   enter 进入课堂（表 3-13）→ signinState 签到状态（8s 轮询，驱动签到红点与在线人数）
//   signin 课堂签到（表 3-14，支持 numeric 课程码/qr 二维码/location 位置/photo 拍照/gesture 手势）
//   stuRoster 学生花名册；quizCurrent 随堂测试当前状态（驱动测试红点）
// 注：URL 可显式传 sessionId 覆盖（调试口）；未传时按当前进行中的课堂解析，无课显示空态
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const config = require('../../utils/config')
const STATE_POLL = 8000    // 签到状态 + 测试状态轮询间隔
const ROSTER_POLL = 10000  // 花名册轮询间隔（教师加分/标迟到后自动刷新）

// 教师可能开启的签到方式，label 为学生端文案。
// 历史上存在两套命名（教师发布端 code/scan/geofence 与学生端 numeric/qr/location），全部兼容。
const SIGN_WAYS = {
  numeric: '课程码签到',
  code: '课程码签到',
  qr: '二维码签到',
  scan: '二维码签到',
  location: '位置签到',
  geofence: '位置签到',
  photo: '拍照签到',
  gesture: '手势签到'
}

// 教师命名 → 学生端子流程（numeric=输码 / qr=扫码 / location=定位 / photo=拍照 / gesture=手势）
const WAY_FLOW = {
  numeric: 'numeric',
  code: 'numeric',
  qr: 'qr',
  scan: 'qr',
  location: 'location',
  geofence: 'location',
  photo: 'photo',
  gesture: 'gesture'
}

const STAGE_TEXT = { ongoing: '进行中', finished: '已结束', scheduled: '未开始' }

/** '2026-10-08T10:25:05' → '10:25' */
function hmOf(iso) { return (iso || '').slice(11, 16) }

/** '2026-10-08 10:25:05' 或 ISO → 分钟时间戳（比较截止用） */
function toTs(s) {
  if (!s) return 0
  return new Date(String(s).replace('T', ' ').replace(/-/g, '/')).getTime()
}

Page({
  data: {
    sessionId: 0,
    loading: true,
    noClass: false,   // 当前没有进行中的课堂（教师未开课）
    // 课堂状态卡（enter 填充）
    current: {
      course: '',
      week: '',
      teacher: '',
      room: '',
      section: '',
      stage: '',
      signed: 0,      // 已签到人数（8s 轮询刷新）
      should: 0,      // 应到人数（选课人数）
      online: 0       // 学生在线人数（WebSocket 连接数，服务端 presence 广播 + 轮询兜底）
    },
    // ===== 导航 =====
    tab: 'class',        // class 课堂 | quiz 随堂测试
    quizDot: false,     // 随堂测试红点：有新测试且未首次查看
    // ===== 签到 =====
    signed: false,
    signedTime: '',
    signinDot: false,    // 签到红点：教师发布签到且我未签且未过期
    // 签到面板（type 选择 + 各方式子面板）
    signinPanel: false,
    signinWays: [],      // 本次任务开启的方式 [{key,label}]
    codeInput: '',       // numeric 课程码输入
    gestureShow: false,  // 手势面板
    gestureDots: [],     // 已点亮点位（1-9 序列）
    // ===== 花名册 =====
    rosterShow: false,
    roster: [],          // [{name, perfScore, lateCount, absentCount}]
    rosterTotal: 0,
    // ===== 随堂测试 =====
    quiz: {
      quizId: null,
      title: '',
      deadline: '',
      active: false,
      submitted: false,
      correctCount: null,
      total: 0,
      courseId: null
    }
  },

  onLoad(options) {
    this.stateTimer = null
    this.rosterTimer = null
    const explicit = Number(options.sessionId) || 0
    if (explicit) {
      // 调试口：URL 显式指定课堂
      this.setData({ sessionId: explicit })
      this.enterClass()
      this.refreshState()
      return
    }
    this.resolveCurrent()
  },

  /** 当前课堂发现：按我的选课解析进行中的课堂；教师未开课 → 空态 */
  async resolveCurrent() {
    let cur = null
    try { cur = await api.classroom.current() } catch (e) { /* request 层已 toast */ }
    // 兼容驼峰/下划线两种键名（后端返回 session_id）
    const sid = Number(cur.sessionId || cur.session_id || 0)
    if (sid > 0) {
      this.setData({ sessionId: sid })
      this.enterClass()
      this.refreshState()
      this.connectWS()   // onShow 抢跑时 sessionId 还是 0，解析完成后再连 WS
      return
    }
    this.setData({ loading: false, noClass: true })
  },

  onShow() { this.pageVisible = true; this.startTimers(); this.connectWS() },
  onHide() { this.stopTimers(); this.closeWS(); this.pageVisible = false },
  onUnload() { this.stopTimers(); this.closeWS(); this.pageVisible = false },

  // ===== WebSocket 在线状态（连接即「在线」，服务端按学生连接数统计并广播） =====

  connectWS() {
    this.closeWS()
    const token = auth.getToken()
    // 课堂未解析到（sessionId=0，onShow 可能先于 resolveCurrent 完成）或页面不可见时不连接，
    // 解析成功后由 resolveCurrent 补连
    if (!token || !this.pageVisible || !this.data.sessionId) return
    const wsBase = config.BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '')
    this.wsVisible = true
    this.wsTask = wx.connectSocket({ url: wsBase + '/ws/session/' + this.data.sessionId + '?token=' + token })
    this.wsTask.onOpen(() => this.refreshState())
    this.wsTask.onMessage((msg) => this.onWSMessage(msg))
    this.wsTask.onClose(() => {
      this.wsTask = null
      // 页面仍可见 → 5s 后重连（断网恢复/服务端重启场景）
      if (this.wsVisible) {
        this.wsRetry = setTimeout(() => { if (this.wsVisible) this.connectWS() }, 5000)
      }
    })
    this.wsTask.onError(() => { /* 随后触发 onClose 走重连 */ })
  },

  closeWS() {
    this.wsVisible = false
    if (this.wsRetry) { clearTimeout(this.wsRetry); this.wsRetry = null }
    if (this.wsTask) {
      try { this.wsTask.close({}) } catch (e) { /* 已断开 */ }
      this.wsTask = null
    }
  },

  /** 服务端下行 {type,payload}：presence 在线人数实时更新；session_end 课堂被结束（含超时自动关闭） */
  onWSMessage(msg) {
    try {
      const m = JSON.parse(msg.data || '{}')
      if (m.type === 'presence' && m.payload && typeof m.payload.onlineCount === 'number') {
        this.setData({ 'current.online': m.payload.onlineCount })
      } else if (m.type === 'session_end' && m.payload) {
        // 课堂被结束（教师手动 / 下课 5 分钟后超时自动）：断开连接并回到空态
        wx.showToast({ title: '本节课已结束', icon: 'none' })
        this.closeWS()
        this.setData({ noClass: true, loading: false })
      }
    } catch (e) { /* 非业务消息忽略 */ }
  },

  // ===== 轮询生命周期 =====

  startTimers() {
    if (this.stateTimer) return
    this.stateTimer = setInterval(() => this.refreshState(), STATE_POLL)
  },

  stopTimers() {
    if (this.stateTimer) { clearInterval(this.stateTimer); this.stateTimer = null }
    if (this.rosterTimer) { clearInterval(this.rosterTimer); this.rosterTimer = null }
  },

  /** 签到状态 + 当前测试（红点与在线人数的数据源） */
  async refreshState() {
    try {
      const st = await api.classroom.signinState(this.data.sessionId)
      const task = st.signinTask || null
      const signed = !!st.signed
      // 签到红点：任务进行中 + 我未签 + 未过期
      const notExpired = task && toTs(task.expireAt) > Date.now()
      this.setData({
        signed,
        signedTime: st.myAttendance ? hmOf(st.myAttendance.sign_time) : '',
        signinDot: !!(task && !signed && notExpired),
        'current.signed': st.signedCount || 0,
        'current.should': st.shouldCount || 0,
        // onlineCount 仅在线时才覆盖（旧版后端无该字段时保留 WS/上次值）
        ...(typeof st.onlineCount === 'number' ? { 'current.online': st.onlineCount } : {})
      })
    } catch (e) { /* 轮询失败静默 */ }
    try {
      const q = await api.classroom.quizCurrent(this.data.sessionId)
      // 测试红点：有进行中的测试 + 未提交 + 尚未首次查看（看过一次即消，wx 本地记忆）
      const seen = (wx.getStorageSync('quiz-seen-' + q.quizId) || false)
      const dot = !!(q.quizId && q.active && !q.submitted && !seen)
      this.setData({ quizDot: dot, quiz: q })
    } catch (e) { /* 轮询失败静默 */ }
  },

  // ===== 表 3-13 进入课堂 =====

  async enterClass() {
    try {
      const s = await api.classroom.enter(this.data.sessionId)
      if (s && s.withinEntryWindow === false) {
        this.setData({ loading: false })
        wx.showModal({
          title: '当前不在上课时间',
          content: s.windowHint || '课堂进入窗口为课前 30 分钟至课后 10 分钟，请在上课时间再进入。',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      const ct = s.class_time || ''
      const week = ct ? (Number(ct.slice(5, 7)) + '月' + Number(ct.slice(8, 10)) + '日') : ''
      const cur = this.data.current
      this.setData({
        loading: false,
        current: {
          course: s.course_name || '',
          week: week,
          teacher: s.teacher_name || '',
          room: s.classroom_name || '教室待定',
          section: (s.period_no || '') + ' 节',
          stage: STAGE_TEXT[s.status] || (s.status || ''),
          signed: cur.signed,
          should: cur.should,
          online: cur.online
        }
      })
    } catch (e) {
      // request 层已 toast（未选课 403 / 课堂不存在 404 等）
      this.setData({ loading: false })
    }
  },

  // ===== 导航 =====

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    // 随堂测试红点：第一次点击后消失（本地记忆该 quizId 已查看）
    if (tab === 'quiz') {
      const q = this.data.quiz
      if (q.quizId) wx.setStorageSync('quiz-seen-' + q.quizId, true)
      this.setData({ tab, quizDot: false })
    } else {
      this.setData({ tab })
    }
  },

  // ===== 签到（表 3-14） =====

  /** 点签到按钮：无任务 toast；有任务弹方式面板 */
  async tapSignin() {
    if (this.data.signed) {
      wx.showToast({ title: '你已完成本次签到（' + (this.data.signedTime || '') + '）', icon: 'none' })
      return
    }
    let st
    try {
      st = await api.classroom.signinState(this.data.sessionId)
    } catch (e) {
      // request 层已 toast
      return
    }
    const task = st.signinTask
    if (!task || toTs(task.expireAt) <= Date.now()) {
      wx.showToast({ title: '教师还未发布任何签到', icon: 'none' })
      return
    }
    let types = []
    try { types = JSON.parse(task.signTypes || '[]') || [] } catch (e) { types = [] }
    const ways = types.filter((t) => SIGN_WAYS[t]).map((t) => ({ key: t, flow: WAY_FLOW[t], label: SIGN_WAYS[t] }))
    if (!ways.length) {
      wx.showToast({ title: '教师还未发布任何签到', icon: 'none' })
      return
    }
    this.setData({ signinPanel: true, signinWays: ways, codeInput: '' })
  },

  closeSigninPanel() {
    this.setData({ signinPanel: false, gestureShow: false, gestureDots: [] })
  },

  /** 选中签到方式 → 对应子流程（flow 决定交互，key 用教师原始命名提交） */
  chooseWay(e) {
    const key = e.currentTarget.dataset.key
    const flow = WAY_FLOW[key] || key
    if (flow === 'numeric') {
      // 课程码：弹可编辑输入框（基础库 2.17.1+）
      wx.showModal({
        title: '课程码签到',
        editable: true,
        placeholderText: '输入教师公布的课程码',
        confirmColor: '#0d9488',
        success: (res) => {
          if (res.confirm) this.doSign(key, { value: (res.content || '').trim() })
        }
      })
    } else if (flow === 'qr') {
      wx.scanCode({
        success: (res) => this.doSign(key, { value: res.result || '' }),
        fail: () => { /* 用户取消扫码 */ }
      })
    } else if (flow === 'location') {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => this.doSign(key, {
          meta: JSON.stringify({ lat: res.latitude, lng: res.longitude })
        }),
        fail: () => wx.showToast({ title: '获取定位失败，请检查定位权限', icon: 'none' })
      })
    } else if (flow === 'photo') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0]
          this.doSign(key, { meta: 'photo:' + (f ? f.tempFilePath : '') })
        },
        fail: () => { /* 用户取消拍照 */ }
      })
    } else if (flow === 'gesture') {
      this.setData({ gestureShow: true, gestureDots: [] })
    }
  },

  /** 统一提交签到（表 3-14） */
  async doSign(signType, extra) {
    try {
      const res = await api.classroom.signin(this.data.sessionId, Object.assign({
        signType: signType, value: '', meta: ''
      }, extra || {}))
      this.setData({ signinPanel: false, gestureShow: false, gestureDots: [], signed: true, signedTime: hmOf(res.signTime) })
      wx.showToast({ title: res.message || '签到成功', icon: 'success' })
      this.refreshState()
    } catch (e) {
      // request 层已 toast（口令错误 422 / 已签过 409 等）
    }
  },

  // ===== 手势签到：九宫格点位序列（教师现场展示手势，学生按序点亮） =====

  tapGestureDot(e) {
    const n = Number(e.currentTarget.dataset.n)
    if (!n || this.data.gestureDots.indexOf(n) >= 0) return
    this.setData({ gestureDots: this.data.gestureDots.concat([n]) })
  },

  undoGesture() { this.setData({ gestureDots: this.data.gestureDots.slice(0, -1) }) },
  clearGesture() { this.setData({ gestureDots: [] }) },

  submitGesture() {
    if (!this.data.gestureDots.length) {
      wx.showToast({ title: '请先按教师展示的手势点亮点位', icon: 'none' })
      return
    }
    this.doSign('gesture', { meta: this.data.gestureDots.join('-') })
  },

  // ===== 花名册（学生只读；10s 轮询自动刷新） =====

  async toggleRoster() {
    const show = !this.data.rosterShow
    this.setData({ rosterShow: show })
    if (show) {
      this.loadRoster()
      if (!this.rosterTimer) {
        this.rosterTimer = setInterval(() => {
          if (this.data.rosterShow) this.loadRoster()
        }, ROSTER_POLL)
      }
    } else if (this.rosterTimer) {
      clearInterval(this.rosterTimer)
      this.rosterTimer = null
    }
  },

  async loadRoster() {
    try {
      const res = await api.classroom.stuRoster(this.data.sessionId, 1, 100)
      this.setData({ roster: res.list || [], rosterTotal: res.total || 0 })
    } catch (e) {
      // request 层已 toast（未选课 403 等）
    }
  },

  // ===== 随堂测试 =====

  /** 开始测试：跳作答卷（提交后跳答题情况） */
  goQuiz() {
    const q = this.data.quiz
    if (!q.quizId) return
    wx.navigateTo({ url: '/pages/live-quiz-answer/live-quiz-answer?quizId=' + q.quizId + '&courseId=' + (q.courseId || '') })
  },

  /** 已提交过 → 看本次答题情况 */
  goQuizResult() {
    wx.navigateTo({ url: '/pages/live-quiz-result/live-quiz-result?quizId=' + this.data.quiz.quizId + '&courseId=' + (this.data.quiz.courseId || '') })
  },

  /** 历史测试列表（该课程全部发布记录，新→旧） */
  goQuizHistory() {
    const q = this.data.quiz
    const courseId = q.courseId
    if (!courseId) {
      wx.showToast({ title: '课程信息加载中，请稍候再试', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/live-quiz-history/live-quiz-history?courseId=' + courseId
        + '&courseName=' + encodeURIComponent(this.data.current.course || '')
    })
  }
})
