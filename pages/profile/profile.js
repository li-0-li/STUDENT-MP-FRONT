// 我的 —— 原型：ui-prototype/mp/app-profile.html（tabBar 页）
// 功能入口按文档 7.15：我的学情、我的课程、实名认证、设置、客服
// 接入：api.user.me（表 2-14 当前用户信息）；学习统计取自
//   api.course.listMine（表 3-1 已选课程数）+ api.homework.list（表 3-5 已交作业/平均分）
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { FILE_BASE_URL } = require('../../utils/config')

// 头像地址：相对路径（如 /files/avatar/xx.png）拼静态文件根地址
function avatarUrl(u) {
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : FILE_BASE_URL + u
}

Page({
  data: {
    loading: true,
    user: {
      name: '',
      avatarUrl: '',
      subtitle: '',   // 班级 · 学号 xxx
      school: ''
    },
    stats: [
      { num: '-', label: '已选课程' },
      { num: '-', label: '平均分' },
      { num: '-', label: '已交作业' }
    ],
    // 学习入口
    studyEntries: [
      { key: 'analytics', icon: '📊', label: '我的学情' },
      { key: 'courses', icon: '📚', label: '我的课程' }
    ],
    // 通用入口（实名认证 / 设置 / 客服）
    generalEntries: [
      { key: 'verify', icon: '🪪', label: '实名认证' },
      { key: 'settings', icon: '⚙️', label: '设置' },
      { key: 'support', icon: '🎧', label: '客服', badge: 0 }
    ]
  },

  onShow() {
    this.loadMe()
    this.loadStats()
  },

  // 当前用户信息（表 2-14：name/userNo/className/avatar 等；
  //   后端仅返回 majorId/schoolId，无专业/学校名称，故不展示）
  async loadMe() {
    this.setData({ loading: true })
    try {
      const u = await api.user.me()
      const name = u.name || u.username || ''
      this.setData({
        loading: false,
        user: {
          name,
          avatarUrl: avatarUrl(u.avatar),
          subtitle: [u.className, u.userNo ? '学号 ' + u.userNo : ''].filter(Boolean).join(' · '),
          school: ''
        }
      })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // 学习统计：已选课程（表 3-1 total）；已交作业 / 平均分（表 3-5 我的提交状态与得分）
  async loadStats() {
    try {
      const courses = await api.course.listMine({ page: 1, pageSize: 1 })
      const hw = await api.homework.list({ page: 1, pageSize: 100 })
      const hwList = (hw && hw.list) || []
      const submitted = hwList.filter(function (it) { return it.myStatus })
      const scores = submitted.map(function (it) { return it.myScore }).filter(function (s) { return typeof s === 'number' })
      const avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b }, 0) / scores.length) : 0
      this.setData({
        stats: [
          { num: (courses && courses.total) || 0, label: '已选课程' },
          { num: avg, label: '平均分' },
          { num: submitted.length, label: '已交作业' }
        ]
      })
    } catch (e) {
      // request 层已 toast，统计保持占位
    }
  },

  // 功能入口跳转
  goEntry(e) {
    const key = e.currentTarget.dataset.key
    // tabBar 页（我的课程）用 switchTab，其余 navigateTo
    if (key === 'courses') { wx.switchTab({ url: '/pages/courses/courses' }); return }
    if (key === 'verify') {
      // 实名认证接口由 M-A 提供（与管理端「师生资料上传」档案比对），当前为演示提示
      wx.showToast({ title: '实名认证待接入（M-A）', icon: 'none' })
      return
    }
    const urls = {
      analytics: '/pages/analytics/analytics',
      settings: '/pages/settings/settings',
      support: '/pages/support/support'
    }
    if (urls[key]) wx.navigateTo({ url: urls[key] })
  },

  // 退出登录：清 token 后回登录页
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
