// 登录 —— 原型：ui-prototype/mp/app-login.html（老师 / 学生身份选择 + 密码登录）
// 接入（itap-merged，M-A 已提供的接口）：
//   密码登录   POST /api/v1/auth/login → {accessToken, refreshToken, ...}（旧 itap-server 为 {token,...}，兼容取值）
// 2026-11-26：移除邮箱/手机验证码登录（验证码提交接口后端从未提供，原为无法登录的半成品）
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
    // 密码方式
    username: '',
    password: '',
    submitting: false
  },

  // ===== 身份选择 =====
  pickRole(e) {
    this.setData({ role: e.currentTarget.dataset.role })
  },

  // ===== 输入 =====
  onUsername(e) { this.setData({ username: e.detail.value }) },
  onPassword(e) { this.setData({ password: e.detail.value }) },

  // ===== 提交登录（表 2-1 账号密码登录） =====
  async doLogin() {
    if (this.data.submitting) return
    const { role } = this.data
    const { username, password } = this.data

    if (!username.trim()) { wx.showToast({ title: '请输入' + ROLE_CFG[role].ph, icon: 'none' }); return }
    if (!password) { wx.showToast({ title: '请输入密码', icon: 'none' }); return }

    this.setData({ submitting: true })
    try {
      // api.auth.login 内部已带 clientType:'mp_student'
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
  }
})
