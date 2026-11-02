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
      // 逐选项预计算「我的/正确」标记（WXML 无法调用方法；multi 的答案是 'A,C' 逗号串 → 按集合匹配）
      const answers = (r.answers || []).map((a) => {
        const mine = String(a.myAnswer || '').split(',').map((s) => s.trim()).filter(Boolean)
        const right = String(a.rightAnswer || '').split(',').map((s) => s.trim()).filter(Boolean)
        const options = this.parseOptions(a.options, a.qType).map((op) => Object.assign({}, op, {
          mine: mine.indexOf(op.key) >= 0,
          right: right.indexOf(op.key) >= 0
        }))
        return Object.assign({}, a, { options })
      })
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

  // 按题型渲染选项：single → 题库 options；judge → 固定 正确/错误；其余无选项题型 → 无选项卡（只显示文字作答行）
  parseOptions(raw, qType) {
    if (qType === 'judge') return [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
    if (!raw) return []
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
