// 随堂测试 · 历史测试页（2026-10-29）
// 用法：?courseId=x —— 该课程发布过的全部测试，时间由近到远
//      已参加 → 正确率 + 查看详情 → 答题情况页
//      未参加 → “未参加测试” + 查看详情 → 答题页只读模式（无提交按钮）
const api = require('../../utils/api')

Page({
  data: {
    courseId: null,
    loading: true,
    list: []   // [{quizId,title,publishTime,deadline,total,submitted,correctCount,accuracy,active}]
  },

  onLoad(options) {
    this.setData({ courseId: Number(options.courseId || 0) })
    this.load()
  },

  async load() {
    try {
      const r = await api.classroom.courseQuizzes(this.data.courseId)
      // 时间由近到远（后端已按发布时间倒序，前端再兜底一次）
      const list = (r.list || []).slice().sort((a, b) => String(b.publishTime || '').localeCompare(String(a.publishTime || '')))
      this.setData({ loading: false, list })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // 查看详情：已参加 → 答题情况页；未参加 → 答题页只读
  goDetail(e) {
    const { quizId, submitted } = e.currentTarget.dataset
    const courseId = this.data.courseId
    if (submitted) {
      wx.navigateTo({ url: '/pages/live-quiz-result/live-quiz-result?quizId=' + quizId + '&courseId=' + courseId })
    } else {
      wx.navigateTo({ url: '/pages/live-quiz-answer/live-quiz-answer?quizId=' + quizId + '&readonly=1&courseId=' + courseId })
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  }
})
