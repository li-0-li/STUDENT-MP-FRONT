// 登录 —— 原型：ui-prototype/mp/app-login.html（老师 / 学生身份选择 + 密码 / 邮箱验证码 / 手机验证码）
// 接入（itap-merged，M-A 已提供的接口）：
//   密码登录   POST /api/v1/auth/login → {accessToken, refreshToken, ...}（旧 itap-server 为 {token,...}，兼容取值）
//   发送验证码 POST /api/v1/auth/captcha/send（channel=phone/email, scene=login，60s 限流）
//   验证码登录 提交接口 M-A 尚未提供，入口保留原演示提示
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 身份文案配置（对齐原型 CFG）
const ROLE_CFG = {
  teacher: { ph: '工号 / 手机号' },
  student: { ph: '学号 / 手机号' }
}

Page({
  data: {
    role: 'student',   // 身份：teacher / student（默认学生；管理员仅支持电脑端，小程序不开放）
    mode: 'pwd',       // 登录方式：pwd 密码 / mail 邮箱验证码 / phone 手机验证码
    // 密码方式
    username: '',
    password: '',
    // 邮箱验证码方式
    mailAccount: '',
    mailCode: '',
    countingMail: false, countdownMail: 0,
    // 手机验证码方式
    phoneAccount: '',
    phoneCode: '',
    countingPhone: false, countdownPhone: 0,
    submitting: false
  },

  // ===== 身份选择 =====
  pickRole(e) {
    this.setData({ role: e.currentTarget.dataset.role })
  },

  // ===== 登录方式切换 =====
  pickMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode })
  },

  // ===== 密码方式输入 =====
  onUsername(e) { this.setData({ username: e.detail.value }) },
  onPassword(e) { this.setData({ password: e.detail.value }) },

  // ===== 邮箱验证码方式输入 =====
  onMailAccount(e) { this.setData({ mailAccount: e.detail.value }) },
  onMailCode(e) { this.setData({ mailCode: e.detail.value }) },

  // ===== 手机验证码方式输入 =====
  onPhoneAccount(e) { this.setData({ phoneAccount: e.detail.value }) },
  onPhoneCode(e) { this.setData({ phoneCode: e.detail.value }) },

  // ===== 验证码倒计时（60s）=====
  startCountdown(kind) {
    const f = kind === 'mail' ? 'Mail' : 'Phone'
    this.setData({ ['counting' + f]: true, ['countdown' + f]: 60 })
    this['_timer' + f] = setInterval(() => {
      const n = this.data['countdown' + f] - 1
      if (n <= 0) {
        clearInterval(this['_timer' + f])
        this.setData({ ['counting' + f]: false, ['countdown' + f]: 0 })
      } else {
        this.setData({ ['countdown' + f]: n })
      }
    }, 1000)
  },
  onUnload() {
    if (this._timerMail) clearInterval(this._timerMail)
    if (this._timerPhone) clearInterval(this._timerPhone)
  },

  // 发送邮箱验证码：POST /api/v1/auth/captcha/send（channel=email, scene=login）
  async sendMailCode() {
    const v = this.data.mailAccount.trim()
    if (this.data.countingMail) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { wx.showToast({ title: '请输入正确的邮箱地址', icon: 'none' }); return }
    try {
      await api.auth.sendCaptcha({ target: v, channel: 'email', scene: 'login' })
      wx.showToast({ title: '验证码已发送至邮箱', icon: 'none' })
      this.startCountdown('mail')
    } catch (e) {
      // 失败（60s 限流 429 / 渠道未接通等）：request 层已统一 toast，不进倒计时
    }
  },

  // 发送手机验证码：POST /api/v1/auth/captcha/send（channel=phone, scene=login）
  async sendPhoneCode() {
    const v = this.data.phoneAccount.trim()
    if (this.data.countingPhone) return
    if (!/^1[3-9]\d{9}$/.test(v)) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }
    try {
      await api.auth.sendCaptcha({ target: v, channel: 'phone', scene: 'login' })
      wx.showToast({ title: '验证码已发送', icon: 'none' })
      this.startCountdown('phone')
    } catch (e) {
      // 失败（60s 限流 429 / 渠道未接通等）：request 层已统一 toast，不进倒计时
    }
  },

  // ===== 提交登录 =====
  async doLogin() {
    if (this.data.submitting) return
    const { role, mode } = this.data

    // 密码方式：表 2-1 账号密码登录（api.auth.login 内部已带 clientType:'mp_student'）
    if (mode === 'pwd') {
      const { username, password } = this.data
      if (!username.trim()) { wx.showToast({ title: '请输入' + ROLE_CFG[role].ph, icon: 'none' }); return }
      if (!password) { wx.showToast({ title: '请输入密码', icon: 'none' }); return }

      this.setData({ submitting: true })
      try {
        const data = await api.auth.login({ username: username.trim(), password })
        // itap-merged（M-A 实现）返回 accessToken；旧 itap-server 返回 token —— 两者兼容
        const token = (data && (data.accessToken || data.token)) || ''
        if (!token) { wx.showToast({ title: '登录响应异常', icon: 'none' }); return }
        auth.setToken(token)
        // M-A 响应体不含 role 字段，回退用所选身份
        auth.setRole(data.role || role)
        wx.reLaunch({ url: '/pages/home/home' })
      } catch (e) {
        // 失败：request 层已统一 toast
      } finally {
        this.setData({ submitting: false })
      }
      return
    }

    // 验证码方式（邮箱 / 手机）
    // TODO 联调：验证码登录接口由 M-A 提供（表 2-x 验证码登录），当前仅前端校验
    if (mode === 'mail') {
      const v = this.data.mailAccount.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { wx.showToast({ title: '请输入正确的邮箱地址', icon: 'none' }); return }
      if (this.data.mailCode.trim().length < 6) { wx.showToast({ title: '请输入 6 位验证码', icon: 'none' }); return }
    } else {
      const v = this.data.phoneAccount.trim()
      if (!/^1[3-9]\d{9}$/.test(v)) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }
      if (this.data.phoneCode.trim().length < 6) { wx.showToast({ title: '请输入 6 位验证码', icon: 'none' }); return }
    }
    wx.showToast({ title: 'TODO 联调：验证码登录（M-A）', icon: 'none' })
  },

  goRegister() { wx.navigateTo({ url: '/pages/register/register' }) },
  goForgot() { wx.navigateTo({ url: '/pages/forgot-password/forgot-password' }) },
  goSupport() { wx.navigateTo({ url: '/pages/support/support' }) }
})
