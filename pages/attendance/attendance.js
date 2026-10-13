// 课堂签到 —— 原型：ui-prototype/mp/app-attendance.html（UI 设计文档 7.11 关联页）
// 结构：课堂状态卡（签到剩余/已签应到）→ 签到状态 → 选择签到方式 → 出勤统计 → 签到记录
// 接入：api.classroom.enter（表 3-13，取节次）+ signinState / signin（表 3-14）
//   signinTask.signTypes 决定各签到方式是否开启；expireAt 驱动「签到剩余」倒计时
// 注：后端暂无「课堂列表/发现」接口，页面参数可传 sessionId 覆盖，未传时默认种子演示课堂 9001
// 遗留：出勤统计/最近签到记录（stats/rate/records）后端无考勤汇总接口，暂保留静态演示值
const api = require('../../utils/api')

const DEFAULT_SESSION_ID = 9001

const WAY_TEXT = { qr: '扫码签到', location: '定位签到', photo: '拍照签到', numeric: '数字口令', manual: '手动点名' }

/** '2026-10-08T17:01:11' → '17:01' */
function hmOf(iso) { return (iso || '').slice(11, 16) }

Page({
  data: {
    sessionId: DEFAULT_SESSION_ID,
    loading: true,
    // 课堂状态卡（enter + signinState 填充）
    lesson: {
      course: '',
      week: '',        // 上课日期（后端无学期周次字段，用 class_time 日期展示）
      teacher: '',
      room: '',
      section: '',
      countdown: '--:--',   // 签到剩余（signinTask.expireAt 倒计时）
      rate: '-- / --'       // 已签 / 应到（signinState.signedCount/shouldCount）
    },
    signed: false,      // 签到状态（signinState.signed）
    signedWay: '',      // 签到方式名
    signedTime: '',
    code: '',           // 数字口令输入
    // 签到方式列表（open 由 signinTask.signTypes 实时决定）
    ways: [
      { key: 'qr', icon: '🔍', nm: '扫码签到', ds: '对准课堂二维码', open: false },
      { key: 'location', icon: '📍', nm: '定位签到', ds: '教室内自动定位', open: false },
      { key: 'photo', icon: '📷', nm: '拍照签到', ds: '活体人脸核验', open: false },
      { key: 'numeric', icon: '#️⃣', nm: '数字口令', ds: '输入 6 位口令', open: false },
      { key: 'manual', icon: '✋', nm: '手动点名', ds: '请老师标记', open: false }
    ],
    openWays: '',       // 教师本次已开启方式名（提示条）
    modal: '',          // 当前弹层：location / photo / numeric / manual
    // 我的出勤统计：后端无考勤汇总接口（仅 signinState 提供单次课堂数据），保留静态演示值
    stats: [
      { key: 'attend', label: '出勤', num: 26, cls: 'stat-ok' },
      { key: 'late', label: '迟到', num: 3, cls: 'stat-warn' },
      { key: 'absent', label: '缺勤', num: 1, cls: 'stat-err' }
    ],
    rate: 86,           // 出勤率（同上，静态演示值）
    // 最近签到记录：同上，后端无签到历史查询接口，保留静态演示值
    records: [
      { course: '数据结构', date: '09-28', result: '出勤', badge: 'badge-success' },
      { course: '高等数学 A', date: '09-25', result: '出勤', badge: 'badge-success' },
      { course: '数据结构', date: '09-21', result: '迟到', badge: 'badge-warning' },
      { course: '大学英语 III', date: '09-18', result: '缺勤', badge: 'badge-error' }
    ]
  },

  onLoad(options) {
    this.countdownTimer = null
    this.loaded = false
    this.setData({ sessionId: Number(options.sessionId) || DEFAULT_SESSION_ID })
    this.loadLesson()
  },

  // 从后台切回 / 他页返回时刷新签到进度与倒计时
  onShow() {
    if (this.loaded) this.refreshState()
  },

  onUnload() { this.stopCountdown() },
  onHide() { this.stopCountdown() },

  // ===== 数据加载 =====

  // enter（表 3-13，取节次/日期）与 signinState（表 3-14 读侧）并行
  async loadLesson() {
    this.setData({ loading: true })
    const sid = this.data.sessionId
    const jobs = [
      api.classroom.enter(sid).then((s) => {
        const ct = s.class_time || ''
        const week = ct ? (Number(ct.slice(5, 7)) + '月' + Number(ct.slice(8, 10)) + '日') : ''
        this.setData({
          'lesson.course': s.course_name || '',
          'lesson.teacher': s.teacher_name || '',
          'lesson.room': s.classroom_name || '教室待定',
          'lesson.section': (s.period_no || '') + ' 节',
          'lesson.week': week
        })
      }).catch(() => { /* request 层已 toast */ }),
      this.refreshState()
    ]
    await Promise.all(jobs)
    this.loaded = true
    this.setData({ loading: false })
  },

  // 签到状态 + 已签/应到 + 各方式开启状态
  async refreshState() {
    try {
      const st = await api.classroom.signinState(this.data.sessionId)
      const types = this.parseSignTypes(st.signinTask)
      const mine = st.myAttendance
      const ways = this.data.ways.map(function (w) {
        return Object.assign({}, w, { open: types.indexOf(w.key) >= 0 })
      })
      const openWays = ways.filter(function (w) { return w.open })
        .map(function (w) { return w.nm }).join(' · ')
      this.setData({
        ways: ways,
        openWays: openWays,
        signed: !!st.signed,
        signedWay: mine ? (WAY_TEXT[mine.sign_type] || mine.sign_type || '') : '',
        signedTime: mine ? hmOf(mine.sign_time) : '',
        'lesson.rate': (st.signedCount || 0) + ' / ' + (st.shouldCount || 0)
      })
      this.startCountdown(st.signinTask && st.signinTask.expireAt)
    } catch (e) {
      // request 层已 toast
      this.stopCountdown()
      this.setData({ 'lesson.countdown': '--:--' })
    }
  },

  parseSignTypes(task) {
    if (!task || !task.signTypes) return []
    try { return JSON.parse(task.signTypes) || [] } catch (e) { return [] }
  },

  // ===== 签到剩余倒计时（signinTask.expireAt） =====

  startCountdown(expireAt) {
    this.stopCountdown()
    if (!expireAt) {
      this.setData({ 'lesson.countdown': this.data.signed ? '已签到' : '未开启' })
      return
    }
    // iOS 兼容：'2026-10-09T23:59:59' → '2026/10/09 23:59:59'
    const end = new Date(String(expireAt).replace('T', ' ').replace(/-/g, '/')).getTime()
    const tick = () => {
      const left = Math.floor((end - Date.now()) / 1000)
      if (left <= 0) {
        this.setData({ 'lesson.countdown': '已结束' })
        this.stopCountdown()
        return
      }
      const mm = ('0' + Math.floor(left / 60)).slice(-2)
      const ss = ('0' + (left % 60)).slice(-2)
      this.setData({ 'lesson.countdown': mm + ':' + ss })
    }
    tick()
    this.countdownTimer = setInterval(tick, 1000)
  },

  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  },

  // ===== 签到交互 =====

  // 打开签到方式（未开启的方式 toast 提示）
  openWay(e) {
    const key = e.currentTarget.dataset.key
    if (this.data.signed) { wx.showToast({ title: '你已完成签到', icon: 'none' }); return }
    const way = this.data.ways.filter(function (w) { return w.key === key })[0]
    if (!way.open) { wx.showToast({ title: '教师未开启' + way.nm, icon: 'none' }); return }
    if (key === 'qr') { this.scanSign(); return }        // 扫码直接调相机
    this.setData({ modal: key })                        // 其余方式弹层
  },

  closeModal() { this.setData({ modal: '' }) },

  // 数字口令输入
  onCodeInput(e) { this.setData({ code: e.detail.value }) },

  // 扫码签到：二维码内容作为凭证提交，由后端校验 qr_token（不符 422）
  scanSign() {
    const that = this
    wx.scanCode({
      success(res) {
        that.doSign('qr', res.result, '', '扫码签到')
      },
      fail() {
        // 用户取消扫码 / 相机权限未开
        wx.showToast({ title: '已取消扫码', icon: 'none' })
      }
    })
  },

  // 定位签到：取当前坐标随 meta 上报（围栏校验由后端执行）；取不到定位时仍提交（坐标为空）
  locate() {
    const that = this
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        that.doSign('location', '', JSON.stringify({ longitude: res.longitude, latitude: res.latitude }), '定位签到')
      },
      fail() {
        wx.showToast({ title: '定位获取失败，本次未记录坐标', icon: 'none' })
        that.doSign('location', '', '', '定位签到')
      }
    })
  },

  // 拍照签到：人脸核验接口后端暂未提供，直接提交拍照签到凭证
  photoSign() { this.doSign('photo', '', '', '拍照签到') },

  // 数字口令：提交后端校验（不符 422）
  submitCode() {
    const v = (this.data.code || '').trim()
    if (v.length !== 6) { wx.showToast({ title: '请输入 6 位口令', icon: 'none' }); return }
    this.doSign('numeric', v, '', '数字口令')
  },

  // 手动点名：提交点名申请（需教师在签到任务中开启 manual 方式）
  manualSign() { this.doSign('manual', '', '', '手动点名') },

  // 表 3-14 课堂签到统一提交
  async doSign(signType, value, meta, wayText) {
    try {
      const res = await api.classroom.signin(this.data.sessionId, {
        signType: signType, value: value || '', meta: meta || ''
      })
      this.setData({ signed: true, signedWay: wayText, signedTime: res.signTime || '', modal: '' })
      wx.showToast({ title: res.message || '签到成功', icon: 'none' })
      this.refreshState()
    } catch (e) {
      // request 层已 toast（口令错误/未开启/已过期/重复签到 409 等）
    }
  }
})
