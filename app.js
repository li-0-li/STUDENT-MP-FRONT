// 学生端 —— 小程序入口
const { getToken } = require('./utils/auth')
const { BASE_URL } = require('./utils/config')

App({
  globalData: {
    role: 'student',
    userInfo: null,
    systemInfo: null
  },

  onLaunch() {
    try {
      this.globalData.systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    } catch (e) {
      // 基础库版本过低时忽略
    }
    // 未登录则跳登录页（登录后端为 M-A 契约，本地开发可用登录页的「快捷登录」）
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' })
    }
    // 2026-11-16 全局未读角标轮询：每 3s 拉一次未读数刷新消息 tab 角标
    // （此前角标只在切到消息页时刷新，停留其他页时收到新消息不亮）
    this.startBadgePolling()
  },

  /** 全局未读角标轮询（3s）：未登录自动跳过；数值无变化时跳过重复的角标 API 调用；接口失败静默 */
  startBadgePolling() {
    if (this._badgeTimer) return
    this._badgeLast = -1
    this._badgeTimer = setInterval(() => {
      try {
        if (!getToken()) {
          // 未登录/已登出：清角标（仅状态切换时调一次 API）
          if (this._badgeLast !== 0) {
            this._badgeLast = 0
            wx.removeTabBarBadge({ index: 3, fail: function () {} })
          }
          return
        }
        wx.request({
          url: BASE_URL + '/api/v1/notifications/unread-count',
          header: { Authorization: 'Bearer ' + getToken() },
          success: (res) => {
            const body = res.data || {}
            const n = body.code === 0 ? (Number(body.data) || 0) : 0
            if (n > 0) {
              wx.setTabBarBadge({ index: 3, text: n > 99 ? '99+' : String(n), fail: function () {} })
            } else if (this._badgeLast !== 0) {
              wx.removeTabBarBadge({ index: 3, fail: function () {} })
            }
            this._badgeLast = n
          },
          fail: () => {}   // 弱网/后端未启动时静默，不打断轮询
        })
      } catch (e) { /* 轮询永不抛错 */ }
    }, 3000)
  }
})
