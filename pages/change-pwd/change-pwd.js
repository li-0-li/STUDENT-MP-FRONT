// 修改密码 —— 原型：ui-prototype/mp/app-change-pwd.html（强度提示 + 一致性校验 + 登录设备管理）
// 接入：api.user.changePassword —— PUT /api/v1/users/me/password（表 2-6，oldPassword + newPassword）
// 登录设备：后端暂无设备管理接口，仅展示当前登录设备。
const api = require('../../utils/api')

// 密码强度（与原型一致：长度>=8 / 大写 / 数字 / 特殊字符 各计 1 分）
function calcStrength(v) {
  if (!v) return { text: '未输入', color: 'var(--ink-400)', score: 0 }
  let s = 0
  if (v.length >= 8) s++
  if (/[A-Z]/.test(v)) s++
  if (/[0-9]/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v)) s++
  const texts = ['弱', '较弱', '中等', '较强', '强']
  const colors = ['var(--ink-400)', 'var(--error)', 'var(--warning)', 'var(--brand-600)', 'var(--success)']
  return { text: '强度：' + texts[s], color: colors[s], score: s }
}

// 当前登录设备（后端暂无设备管理接口，不做演示数据）
function currentDevice() {
  let model = '本机设备'
  try { model = wx.getSystemInfoSync().model || model } catch (e) {}
  return [{ icon: '📱', name: model, place: '本机', time: '当前', current: true }]
}

Page({
  data: {
    oldPwd: '',
    newPwd: '',
    newPwd2: '',
    showOld: false,
    showNew: false,
    showNew2: false,
    strength: { text: '未输入', color: 'var(--ink-400)', score: 0 },
    matchTip: { text: '', cls: '' },
    devices: []
  },

  onLoad() {
    this.setData({ devices: currentDevice() })
  },

  onOld(e) { this.setData({ oldPwd: e.detail.value }) },

  // 新密码输入：刷新强度与一致性提示
  onNew(e) {
    this.setData({ newPwd: e.detail.value, strength: calcStrength(e.detail.value) })
    this.refreshMatch(e.detail.value, this.data.newPwd2)
  },
  onNew2(e) {
    this.setData({ newPwd2: e.detail.value })
    this.refreshMatch(this.data.newPwd, e.detail.value)
  },
  refreshMatch(a, b) {
    if (!b) { this.setData({ matchTip: { text: '', cls: '' } }); return }
    if (a === b) this.setData({ matchTip: { text: '✓ 两次输入一致', cls: 'ok' } })
    else this.setData({ matchTip: { text: '两次输入不一致', cls: 'bad' } })
  },

  // 密码可见性切换
  togOld() { this.setData({ showOld: !this.data.showOld }) },
  togNew() { this.setData({ showNew: !this.data.showNew }) },
  togNew2() { this.setData({ showNew2: !this.data.showNew2 }) },

  // 下线其它登录设备（后端暂无设备管理接口）
  offline() {
    wx.showToast({ title: '后端暂无设备管理接口', icon: 'none' })
  },

  // 确认修改（表 2-6）
  async save() {
    const { oldPwd, newPwd, newPwd2, strength } = this.data
    // 前端校验（与原型一致）
    if (!oldPwd) { wx.showToast({ title: '请输入原密码', icon: 'none' }); return }
    if (newPwd.length < 8) { wx.showToast({ title: '新密码至少 8 位', icon: 'none' }); return }
    if (strength.score < 2) { wx.showToast({ title: '新密码强度不足，请包含字母与数字', icon: 'none' }); return }
    if (newPwd !== newPwd2) { wx.showToast({ title: '两次输入的密码不一致', icon: 'none' }); return }

    wx.showLoading({ title: '提交中', mask: true })
    try {
      await api.user.changePassword({ oldPassword: oldPwd, newPassword: newPwd })
      wx.hideLoading()
      wx.showToast({ title: '密码修改成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      // request 层已 toast（原密码不正确 / 强度不足等，校验规则与后端 biz_config 一致）
      wx.hideLoading()
    }
  },

  goForgot() { wx.navigateTo({ url: '/pages/forgot-password/forgot-password' }) }
})
