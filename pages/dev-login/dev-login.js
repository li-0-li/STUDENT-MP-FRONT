// 开发期临时登录页 —— 合并前删除
// 调 M-B 后端 dev-only 接口 POST /api/v1/dev/token 签发测试令牌（正式登录走表 2-1，归教师端同学）
const api = require('../../utils/api')
const auth = require('../../utils/auth')

Page({
  data: {
    userId: '1002',      // 测试库学生：李浩一
    username: 'lihaoyi',
    schoolId: '1'
  },

  onUserId(e) { this.setData({ userId: e.detail.value }) },
  onUsername(e) { this.setData({ username: e.detail.value }) },
  onSchoolId(e) { this.setData({ schoolId: e.detail.value }) },

  async login() {
    try {
      const data = await api.dev.token({
        userId: Number(this.data.userId) || 1,
        username: this.data.username,
        role: 'student',
        schoolId: Number(this.data.schoolId) || 1
      })
      auth.setToken(data.token)
      auth.setRole('student')
      wx.showToast({ title: '已签发令牌', icon: 'success' })
      setTimeout(() => wx.reLaunch({ url: '/pages/courses/courses' }), 600)
    } catch (e) {
      // request 层已 toast
    }
  }
})
