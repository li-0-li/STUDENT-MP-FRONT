// 随堂测试 · 作答卷（2026-10-29）
// 用法：?quizId=x            正常作答（提交后 redirectTo 答题情况页）
//      ?quizId=x&readonly=1  只读浏览（历史测试里「未参加测试」的查看详情；无提交按钮）
// 接入：quizSheet 作答卷（不带标准答案）→ quizSubmit 提交（后端客观题规则判分）
const api = require('../../utils/api')

Page({
  data: {
    quizId: null,
    readonly: false,
    loading: true,
    title: '',
    deadline: '',
    total: 0,
    questions: [],   // [{seq, qType, content, options(JSON字符串/数组), picked}]
    submitting: false
  },

  onLoad(options) {
    const quizId = Number(options.quizId || 0)
    const readonly = options.readonly === '1'
    this.setData({ quizId, readonly, courseId: options.courseId || '' })
    if (options.title) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(options.title) })
    }
    this.loadSheet()
  },

  async loadSheet() {
    try {
      const s = await api.classroom.quizSheet(this.data.quizId)
      // 已提交的（未带 readonly 进来）直接跳答题情况页
      if (s.submitted && !this.data.readonly) {
        wx.redirectTo({ url: '/pages/live-quiz-result/live-quiz-result?quizId=' + this.data.quizId })
        return
      }
      const questions = (s.questions || []).map((q) => ({
        seq: q.seq,
        questionId: q.questionId,
        qType: q.qType,
        multi: q.qType === 'multi',
        content: q.content || '',
        options: this.parseOptions(q.options, q.qType).map((op) => Object.assign({}, op, { sel: false })),
        picked: q.qType === 'multi' ? [] : ''
      }))
      this.setData({
        loading: false,
        title: s.title || '随堂测试',
        deadline: s.deadline || '',
        total: s.total || questions.length,
        questions
      })
    } catch (e) {
      // request 层已 toast（已截止 422 / 测试不存在 404 等）
      this.setData({ loading: false })
    }
  },

  // 按题型渲染选项：
  //   single → 题库 options JSON [{key,text}]；judge → 固定 正确/错误 两个选项框；
  //   其余题型（填空/简答等无 options）→ 无选项，作答卷渲染文本输入框
  parseOptions(raw, qType) {
    if (qType === 'judge') return [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
    if (!raw) return []
    let arr = raw
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw) } catch (e) { arr = [] }
    }
    return Array.isArray(arr) ? arr : []
  },

  // 选择答案：single/judge 单选直接记录；multi 多选 → 点选/取消切换 sel 标记
  pick(e) {
    if (this.data.readonly) return
    const idx = Number(e.currentTarget.dataset.idx)
    const key = e.currentTarget.dataset.key
    const q = this.data.questions[idx]
    if (q.multi) {
      const pos = q.picked.indexOf(key)
      const picked = pos >= 0 ? q.picked.filter((k) => k !== key) : q.picked.concat([key])
      const patch = { ['questions[' + idx + '].picked']: picked }
      q.options.forEach((op, oi) => {
        patch['questions[' + idx + '].options[' + oi + '].sel'] = picked.indexOf(op.key) >= 0
      })
      this.setData(patch)
    } else {
      const patch = { ['questions[' + idx + '].picked']: key }
      q.options.forEach((op, oi) => {
        patch['questions[' + idx + '].options[' + oi + '].sel'] = op.key === key
      })
      this.setData(patch)
    }
  },

  // 文本作答（填空/简答等无选项题型）
  typeAnswer(e) {
    if (this.data.readonly) return
    const idx = Number(e.currentTarget.dataset.idx)
    this.setData({ ['questions[' + idx + '].picked']: e.detail.value })
  },

  // 提交测试 → 跳答题情况页
  async submit() {
    if (this.data.readonly || this.data.submitting) return
    const questions = this.data.questions
    // 未作答判定：选项题看是否选了（multi 看数组长度）；文本题看是否输入
    const unanswered = questions.filter((q) =>
      q.options.length ? (q.multi ? q.picked.length === 0 : !q.picked) : !q.picked
    ).length
    const doSubmit = () => {
      this.setData({ submitting: true })
      api.classroom.quizSubmit(this.data.quizId, {
        answers: questions.map((q) => ({
          seq: q.seq, questionId: q.questionId,
          // multi 多选：选中的 key 排序后拼 'A,C'（与题库标准答案格式一致）
          answer: q.multi ? q.picked.slice().sort().join(',') : (q.picked || '')
        }))
      })
        .then(() => {
          wx.redirectTo({ url: '/pages/live-quiz-result/live-quiz-result?quizId=' + this.data.quizId + '&courseId=' + (this.data.courseId || '') })
        })
        .catch(() => {
          // request 层已 toast（截止 422 / 重复提交 409）
          this.setData({ submitting: false })
        })
    }
    if (unanswered > 0) {
      wx.showModal({
        title: '还有未作答题目',
        content: '还有 ' + unanswered + ' 题未作答，确定提交吗？',
        confirmColor: '#0d9488',
        success: (res) => { if (res.confirm) doSubmit() }
      })
    } else {
      doSubmit()
    }
  }
})
