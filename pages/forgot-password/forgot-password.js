// 找回密码 —— 原型：ui-prototype/mp/forgot-password.html（三步：验证 → 重置 → 完成）
// 接入 M-A 认证服务（8081，request.js 自动路由）：
//   POST /api/v1/auth/captcha/send（scene=forgot_pwd）→ POST /api/v1/auth/password/reset
//   M-A 契约按 target（手机号/邮箱）校验验证码并一次性重置密码，账号输入框仅作界面提示
const api = require('../../utils/api')

Page({
  data: {
    step: 1,          // 1 验证 2 重置 3 完成
    account: '',      // 账号（学号 / 工号，仅提示用）
    phone: '',        // 绑定手机号（重置凭据 target）
    code: '',         // 短信验证码
    password: '',     // 新密码
    password2: '',
    counting: false,  // 验证码按钮倒计时中
    countdown: 0,
    submitting: false
  },

  onAccount(e) { this.setData({ account: e.detail.value }) },
  onPhone(e) { this.setData({ phone: e.detail.value }) },
  onCode(e) { this.setData({ code: e.detail.value }) },
  onPwd(e) { this.setData({ password: e.detail.value }) },
  onPwd2(e) { this.setData({ password2: e.detail.value }) },

  // 发送验证码（60s 倒计时；M-A /auth/captcha/send，scene=forgot_pwd）
  async sendCode() {
    const { phone, counting } = this.data
    if (counting) return
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }

    try {
      const res = await api.auth.sendCaptcha({ target: phone.trim(), channel: 'phone', scene: 'forgot_pwd' })
      // 联调期后端开启回显（zhike.verify.return-code），直接提示验证码便于本地测试
      const hint = res && res.code ? '（联调回显：' + res.code + '）' : ''
      wx.showToast({ title: '验证码已发送' + hint, icon: 'none' })
      this.setData({ counting: true, countdown: 60 })
      this._timer = setInterval(() => {
        const n = this.data.countdown - 1
        if (n <= 0) {
          clearInterval(this._timer)
          this.setData({ counting: false, countdown: 0 })
        } else {
          this.setData({ countdown: n })
        }
      }, 1000)
    } catch (e) { /* request.js 已 toast */ }
  },
  onUnload() { if (this._timer) clearInterval(this._timer) },

  // 第 1 步 → 第 2 步：客户端预校验（验证码真实校验在重置接口里一次性完成）
  toStep2() {
    const { account, phone, code } = this.data
    if (!account.trim()) { wx.showToast({ title: '请输入账号', icon: 'none' }); return }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }
    if (code.trim().length < 4) { wx.showToast({ title: '请输入验证码', icon: 'none' }); return }
    this.setData({ step: 2 })
  },

  // 第 2 步 → 第 3 步：提交重置（M-A /auth/password/reset：target+code+newPassword）
  async toStep3() {
    const { phone, code, password, password2, submitting } = this.data
    if (submitting) return
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      wx.showToast({ title: '密码需 8 位以上，且包含字母与数字', icon: 'none' }); return
    }
    if (password !== password2) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return }

    this.setData({ submitting: true })
    try {
      await api.auth.resetPassword({
        target: phone.trim(),
        channel: 'phone',
        code: code.trim(),
        newPassword: password
      })
      this.setData({ step: 3 })
    } catch (e) {
      this.setData({ submitting: false })
    }
  },

  backLogin() { wx.navigateBack() }
})
