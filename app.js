// 学生端 —— 小程序入口
const { getToken } = require('./utils/auth')

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
    // 未登录则跳登录页（跳转正式登录页（登录后端为 M-A 契约，本地开发可用登录页的「快捷登录」）
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' })
    }
  }
})
