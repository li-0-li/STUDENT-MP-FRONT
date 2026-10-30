// 随堂测试 · 答题情况页（2026-10-29）
// 展示：本次正确率 + 做对题数 + 逐题序号色圈（对=绿 / 错=红）
// 跳转：点题号/查看详情 → 单题详情页；「历史测试」→ 该课程历史测试列表
const api = require('../../utils/api')

Page({
  data: {
    quizId: null,
    courseId: '',
    loading: true,
    title: '',
    total: 0,
    correctCount: 0,
    accuracy: 0,     // 百分数（85.7）
    answers: []       // [{seq, correct}]
  },

  onLoad(options) {
    this.setData({
      quizId: Number(options.quizId || 0),
      courseId: options.courseId || ''
    })
    this.load()
  },

  async load() {
    try {
      const r = await api.classroom.quizResult(this.data.quizId)
      this.setData({
        loading: false,
        title: r.title || '随堂测试',
        total: r.total || 0,
        correctCount: r.correctCount || 0,
        accuracy: r.accuracy || 0,
        answers: (r.answers || []).map((a) => ({ seq: a.seq, correct: !!a.correct }))
      })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // 点题号 → 该题详情
  goDetail(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    wx.navigateTo({
      url: '/pages/live-quiz-detail/live-quiz-detail?quizId=' + this.data.quizId + '&idx=' + idx
    })
  },

  // 查看详情 → 第一题详情
  goFirstDetail() {
    wx.navigateTo({
      url: '/pages/live-quiz-detail/live-quiz-detail?quizId=' + this.data.quizId + '&idx=0'
    })
  },

  // 历史测试列表
  goHistory() {
    if (!this.data.courseId) {
      wx.showToast({ title: '缺少课程信息，请从课堂进入', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/live-quiz-history/live-quiz-history?courseId=' + this.data.courseId })
  }
})
