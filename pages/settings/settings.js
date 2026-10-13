// 设置 —— 原型：ui-prototype/mp/app-settings.html（账号安全 / 通知 / 通用 / 隐私设置 / 退出）
// 接入（真实接口）：
//   api.user.me         表 2-14 当前用户（绑定手机号 + 通知偏好 notifyPref）
//   api.user.notifyPref 表 2-16 通知偏好设置（homework / live / notice / message 四类开关）
// 通用与隐私项后端暂无接口：缓存大小取本地真实值；「个性化学习推荐」为本地开关。
const api = require('../../utils/api')
const auth = require('../../utils/auth')

// 通知开关：key 与后端 biz_user_ext.notify_pref 字段一一对应
const NOTIFY_KEYS = [
  { key: 'homework', label: '作业截止提醒' },
  { key: 'live', label: '课堂通知' },
  { key: 'notice', label: '课程公告' },
  { key: 'message', label: '消息通知' }
]

/** 手机号脱敏：138****0003 */
function maskPhone(p) {
  return p && p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : (p || '未绑定')
}

/** 本地缓存真实大小 */
function cacheText() {
  try {
    return (wx.getStorageInfoSync().currentSize / 1024).toFixed(1) + ' MB'
  } catch (e) {
    return '—'
  }
}

Page({
  data: {
    phone: '—',             // 绑定手机号（脱敏展示，来自表 2-14）
    version: 'v1.0.0',
    cacheSize: '—',
    notifyRows: [],         // 通知开关（来自 notifyPref，改动即调表 2-16 持久化）
    privacyRecommend: true  // 隐私设置：个性化学习推荐开关（后端暂无对应接口，本地保存）
  },

  onLoad() {
    this.load()
  },

  /** 表 2-14 当前用户：手机号 + 通知偏好 */
  async load() {
    this.setData({ cacheSize: cacheText() })
    let rows = NOTIFY_KEYS.map(n => ({ key: n.key, label: n.label, on: true }))
    try {
      const me = await api.user.me()
      let pref = {}
      try { pref = me.notifyPref ? JSON.parse(me.notifyPref) : {} } catch (e) { /* notifyPref 非法 JSON 时用默认值 */ }
      rows = NOTIFY_KEYS.map(n => ({ key: n.key, label: n.label, on: pref[n.key] !== false }))
      this.setData({ phone: maskPhone(me.phone) })
    } catch (e) {
      // request 层已 toast，开关回落默认值
    }
    this.setData({ notifyRows: rows })
  },

  // 通知开关切换：本地更新 + 表 2-16 持久化（保存失败回滚）
  toggleNotify(e) {
    const key = e.currentTarget.dataset.key
    const rows = this.data.notifyRows.map((r) => (r.key === key ? Object.assign({}, r, { on: !r.on }) : r))
    this.setData({ notifyRows: rows })
    const pref = {}
    rows.forEach((r) => { pref[r.key] = r.on })
    api.user.notifyPref(pref).catch(() => {
      // request 层已 toast；回滚开关状态
      this.setData({
        notifyRows: this.data.notifyRows.map((r) => (r.key === key ? Object.assign({}, r, { on: !r.on }) : r))
      })
    })
  },

  // 隐私设置开关切换（后端暂无对应接口，本地保存）
  togglePrivacy() {
    this.setData({ privacyRecommend: !this.data.privacyRecommend })
  },

  // 隐私与数据授权（演示说明）
  goPrivacy() {
    wx.showModal({
      title: '隐私与数据授权',
      content: '平台仅在学习分析与课堂互动范围内使用你的学习数据，可在「隐私与数据授权」中查看与撤回授权。',
      showCancel: false
    })
  },

  goChangePwd() { wx.navigateTo({ url: '/pages/change-pwd/change-pwd' }) },
  goChangePhone() { wx.navigateTo({ url: '/pages/change-phone/change-phone' }) },

  // 清除缓存：保留登录令牌（itap_token / itap_role，见 utils/auth.js）
  clearCache() {
    try {
      const info = wx.getStorageInfoSync()
      ;(info.keys || []).forEach((k) => {
        if (k !== 'itap_token' && k !== 'itap_role') wx.removeStorageSync(k)
      })
    } catch (e) {}
    this.setData({ cacheSize: '0.0 MB' })
    wx.showToast({ title: '缓存已清除', icon: 'success' })
  },

  // 退出登录：清 token 后回登录页（二次确认）
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return
        auth.clear()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  }
})
