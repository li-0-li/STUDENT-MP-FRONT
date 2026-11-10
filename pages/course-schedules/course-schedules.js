// 全部排课页（2026-11-10 改版）：全量「第 N 周」大卡片 → 课次小卡片 → 资源挂载
// 与课程详情页「上课安排」同一数据源/同一形态（utils/week-mount.js），
// 差异仅在本页展示全部周块，详情页只展示当前周。
const { loadWeekMount, openItem } = require('../../utils/week-mount')

Page({
  data: {
    courseId: 0,
    courseName: '',
    loading: true,
    weeks: [],        // 周块列表（全部）
    termText: '',
    currentWeek: null
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0)
    if (o.courseName) {
      this.setData({ courseName: decodeURIComponent(o.courseName) })
    }
    if (!this.courseId) {
      wx.showToast({ title: '缺少课程参数', icon: 'none' })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const m = await loadWeekMount(this.courseId)
      this.setData({
        weeks: m.weeks,
        termText: m.termText,
        currentWeek: m.currentWeek,
        loading: false
      })
      wx.setNavigationBarTitle({ title: '全部排课', fail: function () {} })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  // 挂载项点按分发（作业/实验/文件），逻辑见共享模块
  openItem: openItem
})
