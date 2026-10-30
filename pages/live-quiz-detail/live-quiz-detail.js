// 随堂测试 · 单题答题详情页（2026-10-29）
// 布局：顶部「第 x 题」+ swiper 左右滑动（左滑下一题/右滑上一题）
//      左右「上一题 / 下一题」按钮（首题隐藏上一题，末题隐藏下一题）
//      系统返回键 → 回到本次测试的答题情况页（navigateBack）
const api = require('../../utils/api')

Page({
  data: {
    quizId: null,
    loading: true,
    idx: 0,          // 当前题下标（0 起）
    total: 0,
    answers: []      // [{seq, content, options, myAnswer, rightAnswer, analysis, correct}]
  },

  onLoad(options) {
    this.setData({ quizId: Number(options.quizId || 0), idx: Number(options.idx || 0) })
    this.load()
  },

  async load() {
    try {
      const r = await api.classroom.quizResult(this.data.quizId)
      const answers = (r.answers || []).map((a) => Object.assign({ options: this.parseOptions(a.options) }, a))
      this.setData({
        loading: false,
        answers,
        total: answers.length,
        idx: Math.min(this.data.idx, Math.max(0, answers.length - 1))
      })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // options 为题库 JSON 字符串 [{key,text}]；null → judge 题的 正确/错误
  parseOptions(raw) {
    if (!raw) return [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
    let arr = raw
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw) } catch (e) { arr = [] }
    }
    return Array.isArray(arr) ? arr : []
  },

  // swiper 滑动：左滑下一题 / 右滑上一题
  onSwiper(e) {
    this.setData({ idx: e.detail.current })
  },

  prev() {
    if (this.data.idx <= 0) return
    this.setData({ idx: this.data.idx - 1 })
  },

  next() {
    if (this.data.idx >= this.data.total - 1) return
    this.setData({ idx: this.data.idx + 1 })
  }
})
