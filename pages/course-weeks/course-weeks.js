// 章节目录页（2026-11-10 改版：纯目录）—— 课程详情「章节目录」入口进入
// 需求：章节目录只放目录且不关联周次；课次/作业/实验/资源的周聚合展示
// 已移至「上课安排」（详情页当前周）与「全部排课」页（course-schedules）。
// 数据：GET /courses/{id}/detail 的 weeks（章节标题列表）
const api = require('../../utils/api')

Page({
  data: {
    courseId: 0,
    loading: true,
    chapters: []   // [{ index, name }]
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0)
    if (!this.courseId) {
      wx.showToast({ title: '缺少课程参数', icon: 'none' })
      return
    }
    if (o.courseName) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(o.courseName), fail: function () {} })
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const detail = await api.course.detail(this.courseId)
      // 纯目录：只列章节标题，不关联周次/课次/资源
      const chapters = (detail.weeks || []).map(function (w, idx) {
        return { index: idx + 1, name: w.title || '未命名章节' }
      })
      this.setData({ chapters: chapters, loading: false })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  }
})
