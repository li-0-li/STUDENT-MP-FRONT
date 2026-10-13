// 课堂参与 —— 原型：ui-prototype/mp/app-live.html（UI 设计文档 7.11）
// 结构：课堂状态卡 → 老师实时投屏（占位）→ 课堂签到 → 课堂互动（弹幕/抢答/提问/课堂测试）
// 接入（后端 WebSocket 通道表 6-1/6-2 未开放给小程序，一律 REST 轮询）：
//   enter 进入课堂（表 3-13）→ signinState 签到状态（表 3-14 读侧）
//   messages 每 5 秒 sinceId 增量轮询（表 3-16）/ sendMessage 发弹幕
//   signin 一键签到（表 3-14）/ interact 抢答·提问·随堂测作答（表 3-15，interType=race/ask/vote）
// 注：后端暂无「课堂列表/发现」接口，页面参数可传 sessionId 覆盖，
//     未传时默认种子演示课堂 9001（数据结构 · 进行中）
const api = require('../../utils/api')

const DEFAULT_SESSION_ID = 9001
const POLL_INTERVAL = 5000   // 聊天轮询间隔（ms）
const MAX_DANMU = 50         // 弹幕列表保留条数

const STAGE_TEXT = { ongoing: '进行中', finished: '已结束', scheduled: '未开始' }

/** '2026-10-08T10:25:05' → '10:25' */
function hmOf(iso) { return (iso || '').slice(11, 16) }

Page({
  data: {
    sessionId: DEFAULT_SESSION_ID,
    loading: true,
    // 课堂状态卡（enter + signinState 填充）
    current: {
      course: '',
      week: '',       // 上课日期（后端无学期周次字段，用 class_time 日期展示）
      teacher: '',
      room: '',
      section: '',
      stage: '',
      online: ''      // 已签/应到（后端无实时在线人数接口，用签到数近似）
    },
    // 投屏观看区：投屏流/课件接口后端暂未提供（表 6-x），保留占位 UI
    screen: {
      chapter: '第 3 章 · 栈与队列',
      latency: '1.2s',
      viewers: 0,
      sharing: true   // false 时显示「老师暂未共享屏幕」占位
    },
    signed: false,        // 本地签到状态（signinState.signed）
    signedTime: '',
    // 互动方式 tab
    acts: [
      { key: 'danmu', label: '弹幕' },
      { key: 'race', label: '抢答' },
      { key: 'qa', label: '提问' },
      { key: 'quiz', label: '课堂测试' }
    ],
    actTab: 'danmu',
    danmuInput: '',
    danmus: [],           // 课堂聊天（messages 轮询）
    // 抢答（interact race；题目内容暂无下发接口，保留原型题面）
    race: { done: false, rank: '', score: 0 },
    // 提问（interact ask；已提交问题暂无查询接口，本地追加展示）
    qaInput: '',
    qaList: [],
    // 课堂测试：题目暂无下发接口（保留原型题面），作答走 interact(vote) 上报选项
    quiz: {
      timeLeft: '04:32',
      question: '1. 栈的特点是？',
      options: ['先进先出', '后进先出', '随机存取'],
      answer: 1,
      picked: -1,
      submitted: false
    }
  },

  onLoad(options) {
    this.lastMsgId = 0      // 聊天增量轮询游标
    this.signTypes = []     // 教师开启的签到方式（signinTask.signTypes）
    this.pollTimer = null
    this.setData({ sessionId: Number(options.sessionId) || DEFAULT_SESSION_ID })
    this.enterClass()
    this.fetchSigninState()
    this.fetchMessages(true)
  },

  onShow() { this.startPolling() },
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },

  // ===== 聊天轮询生命周期 =====

  startPolling() {
    if (this.pollTimer || !this.data.sessionId) return
    this.pollTimer = setInterval(() => this.fetchMessages(), POLL_INTERVAL)
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  },

  // ===== 数据加载 =====

  // 表 3-13 进入课堂：课堂信息；不在进入窗口（课前30分~课后10分）时拦截
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
      this.setData({
        loading: false,
        current: {
          course: s.course_name || '',
          week: week,
          teacher: s.teacher_name || '',
          room: s.classroom_name || '教室待定',
          section: (s.period_no || '') + ' 节',
          stage: STAGE_TEXT[s.status] || (s.status || ''),
          online: this.data.current.online
        }
      })
    } catch (e) {
      // request 层已 toast（未选课 403 / 课堂不存在 404 等）
      this.setData({ loading: false })
    }
  },

  // 签到状态（表 3-14 读侧）：我的签到 + 已签/应到
  async fetchSigninState() {
    try {
      const st = await api.classroom.signinState(this.data.sessionId)
      this.signTypes = this.parseSignTypes(st.signinTask)
      this.setData({
        signed: !!st.signed,
        signedTime: st.myAttendance ? hmOf(st.myAttendance.sign_time) : '',
        'current.online': (st.signedCount || 0) + '/' + (st.shouldCount || 0) + ' 人'
      })
    } catch (e) {
      this.signTypes = []
    }
  },

  parseSignTypes(task) {
    if (!task || !task.signTypes) return []
    try { return JSON.parse(task.signTypes) || [] } catch (e) { return [] }
  },

  // 课堂聊天（表 3-16 读侧）：reset 全量拉取，否则 sinceId 增量
  async fetchMessages(reset) {
    try {
      const params = reset ? {} : { sinceId: this.lastMsgId }
      const list = await api.classroom.messages(this.data.sessionId, params)
      const fresh = (list || []).map(function (m) {
        return { id: m.message_id, name: m.sender_name || '同学', text: m.content }
      })
      if (!reset && !fresh.length) return
      if (fresh.length) this.lastMsgId = fresh[fresh.length - 1].id
      const danmus = reset ? fresh : this.data.danmus.concat(fresh)
      this.setData({ danmus: danmus.slice(-MAX_DANMU) })
    } catch (e) {
      // 轮询失败静默（网络异常 request 层已 toast）
    }
  },

  // ===== 签到（表 3-14） =====

  // 一键签到：优先用「无需凭证且教师已开启」的方式（location/photo），复杂方式请去课堂签到页
  async doSign() {
    if (this.data.signed) return
    const types = this.signTypes || []
    const signType = types.indexOf('location') >= 0 ? 'location'
      : types.indexOf('photo') >= 0 ? 'photo'
        : (types[0] || 'location')
    try {
      const res = await api.classroom.signin(this.data.sessionId, { signType: signType, value: '', meta: '' })
      this.setData({ signed: true, signedTime: res.signTime || '' })
      wx.showToast({ title: res.message || '签到成功', icon: 'none' })
      this.fetchSigninState()
    } catch (e) {
      // request 层已 toast（未开启/已过期/已签过 409 等）
    }
  },

  // ===== 课堂互动 =====

  // 切换互动 tab
  selectAct(e) {
    this.setData({ actTab: e.currentTarget.dataset.key })
  },

  // 投屏操作（全屏/声音）：投屏控制接口后端暂未提供
  screenTodo(e) {
    const act = e.currentTarget.dataset.act
    wx.showToast({ title: (act === 'full' ? '全屏' : '声音') + '播放联调中', icon: 'none' })
  },

  // 弹幕输入
  onDanmuInput(e) { this.setData({ danmuInput: e.detail.value }) },

  // 发弹幕（表 3-16 发送，敏感词由后端拦截 422），成功后立即增量拉取
  async sendDanmu() {
    const v = this.data.danmuInput.trim()
    if (!v) return
    try {
      await api.classroom.sendMessage(this.data.sessionId, { content: v, msgType: 'text' })
      this.setData({ danmuInput: '' })
      this.fetchMessages()
    } catch (e) {
      // request 层已 toast（敏感词 422 / 内容为空等）
    }
  },

  // 参与抢答（表 3-15 interType=race，后端按参与顺序排名，重复参与 409）
  async doRace() {
    if (this.data.race.done) return
    try {
      const res = await api.classroom.interact(this.data.sessionId, { interType: 'race', content: '抢答' })
      const m = /第\s*(\d+)\s*名/.exec(res.message || '')
      this.setData({
        race: { done: true, rank: m ? '第 ' + m[1] + ' 名' : '已参与', score: res.score || 0 }
      })
      wx.showToast({ title: '抢答成功 +' + (res.score || 0) + ' 分', icon: 'success' })
    } catch (e) {
      // request 层已 toast（已抢答 409 / 敏感词 422）
    }
  },

  // 提问输入 / 提交（表 3-15 interType=ask；已提交问题暂无查询接口，本地追加）
  onQaInput(e) { this.setData({ qaInput: e.detail.value }) },

  async sendQa() {
    const v = this.data.qaInput.trim()
    if (!v) return
    try {
      await api.classroom.interact(this.data.sessionId, { interType: 'ask', content: v })
      const qaList = [{ q: v, a: '等待老师解答…', status: '待解答', badge: 'badge-warning' }].concat(this.data.qaList)
      this.setData({ qaList: qaList, qaInput: '' })
      wx.showToast({ title: '问题已提交', icon: 'none' })
    } catch (e) {
      // request 层已 toast（敏感词 422）
    }
  },

  // 课堂测试：选择选项
  pickOption(e) {
    if (this.data.quiz.submitted) return
    this.setData({ 'quiz.picked': e.currentTarget.dataset.i })
  },

  // 课堂测试：提交作答（题目无下发接口，作答走 interact vote 上报所选项）
  async submitQuiz() {
    const q = this.data.quiz
    if (q.picked < 0) { wx.showToast({ title: '请先选择答案', icon: 'none' }); return }
    try {
      await api.classroom.interact(this.data.sessionId, { interType: 'vote', content: q.options[q.picked] })
      this.setData({ 'quiz.submitted': true })
      wx.showToast({ title: '答案已提交，等待老师收卷', icon: 'none' })
    } catch (e) {
      // request 层已 toast
    }
  }
})
