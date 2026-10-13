// 绑定手机号 —— 原型：ui-prototype/mp/app-change-phone.html
// 接入（真实接口）：
//   api.user.me           表 2-14 当前用户（展示当前绑定手机号）
//   api.user.updateProfile 表 2-7 修改资料（后端 UpdateProfileRequest 支持 phone 字段，换绑以此落库）
// 短信验证：M-A 验证码接口仅支持 register / forgot_pwd 场景，无「换绑手机号」场景，
//   页面验证码环节保留为演示流程；确认更换时不校验验证码，直接调 updateProfile 更新 phone。
const api = require('../../utils/api')

/** 手机号格式化：138 0000 0003 */
function formatPhone(p) {
  return p && p.length === 11 ? p.slice(0, 3) + ' ' + p.slice(3, 7) + ' ' + p.slice(7) : (p || '—')
}

/** 手机号脱敏：138****0003 */
function maskPhone(p) {
  return p && p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : (p || '—')
}

Page({
  data: {
    currentPhone: '—',
    currentPhoneMask: '—',
    oldCode: '',
    newPhone: '',
    newCode: '',
    countingOld: false, countdownOld: 0,
    countingNew: false, countdownNew: 0
  },

  onLoad() {
    this.load()
  },

  /** 表 2-14 当前用户：当前绑定手机号 */
  async load() {
    try {
      const me = await api.user.me()
      this.setData({
        currentPhone: formatPhone(me.phone),
        currentPhoneMask: maskPhone(me.phone)
      })
    } catch (e) {
      // request 层已 toast
    }
  },

  onOldCode(e) { this.setData({ oldCode: e.detail.value }) },
  onNewPhone(e) { this.setData({ newPhone: e.detail.value }) },
  onNewCode(e) { this.setData({ newCode: e.detail.value }) },

  // 通用 60s 倒计时
  startCountdown(field) {
    this.setData({ ['counting' + field]: true, ['countdown' + field]: 60 })
    const timerKey = '_timer' + field
    this[timerKey] = setInterval(() => {
      const n = this.data['countdown' + field] - 1
      if (n <= 0) {
        clearInterval(this[timerKey])
        this.setData({ ['counting' + field]: false, ['countdown' + field]: 0 })
      } else {
        this.setData({ ['countdown' + field]: n })
      }
    }, 1000)
  },
  onUnload() {
    if (this._timerOld) clearInterval(this._timerOld)
    if (this._timerNew) clearInterval(this._timerNew)
  },

  // 向原手机号发送验证码（后端暂无换绑短信场景，验证码为演示）
  sendOld() {
    if (this.data.countingOld) return
    wx.showToast({ title: '后端暂无换绑短信验证场景，验证码为演示', icon: 'none' })
    this.startCountdown('Old')
  },

  // 向新手机号发送验证码（后端暂无换绑短信场景，验证码为演示）
  sendNew() {
    const p = this.data.newPhone.trim()
    if (this.data.countingNew) return
    if (!/^1[3-9]\d{9}$/.test(p)) { wx.showToast({ title: '请先输入有效的 11 位手机号', icon: 'none' }); return }
    wx.showToast({ title: '后端暂无换绑短信场景，验证码为演示', icon: 'none' })
    this.startCountdown('New')
  },

  // 确认更换（表 2-7：updateProfile 的 phone 字段）
  save() {
    const { newPhone, oldCode, newCode } = this.data
    if (!oldCode.trim()) { wx.showToast({ title: '请输入原手机号验证码', icon: 'none' }); return }
    if (!/^1[3-9]\d{9}$/.test(newPhone.trim())) { wx.showToast({ title: '新手机号格式不正确', icon: 'none' }); return }
    if (!newCode.trim()) { wx.showToast({ title: '请输入新手机号验证码', icon: 'none' }); return }

    wx.showModal({
      title: '确认更换',
      content: '确认将绑定手机号更换为 ' + newPhone + ' ？更换后原手机号将无法用于登录与找回密码。',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        try {
          await api.user.updateProfile({ phone: newPhone.trim() })
          wx.hideLoading()
          wx.showToast({ title: '绑定手机号已更新', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 800)
        } catch (e) {
          // request 层已 toast（手机号格式等后端校验）
          wx.hideLoading()
        }
      }
    })
  },

  goSupport() { wx.navigateTo({ url: '/pages/support/support' }) }
})
