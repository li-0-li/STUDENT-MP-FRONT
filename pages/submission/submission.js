// 作业提交 —— 原型：ui-prototype/mp/app-submission.html
// 接入（真实接口）：
//   api.homework.list    表 3-5 作业列表（后端暂无单条作业详情接口，从列表中定位本条）
//   api.homework.submit  表 3-6 提交作业 POST /api/v1/assignments/{assignmentId}/submissions
//   api.homework.appeal  表 3-7 成绩申诉 POST /api/v1/submissions/{submissionId}/appeal
// 教师退回（returned）的作业可直接再次提交（后端按多版本处理，无需走退回重交接口）。
// 题目作答明细 / AI 初判分 / 教师评语后端暂未提供，对应区块仅在数据存在时展示。
const api = require('../../utils/api')

/** myStatus → 展示状态 */
function mapStatus(it) {
  const ms = it.myStatus
  if (ms == null || ms === 'draft') {
    return { statusText: '待提交', badge: 'badge-warning', editable: true, isGraded: false, score: '' }
  }
  if (ms === 'returned') {
    return { statusText: '已退回 · 可重交', badge: 'badge-warning', editable: true, isGraded: false, score: '' }
  }
  if (ms === 'appealing') {
    // 申诉是对成绩的异议：沿用已批改的分数展示（详情接口同样返回上轮批改结果）
    const score = it.myScore != null ? String(it.myScore) : ''
    return { statusText: '申诉处理中', badge: 'badge-error', editable: false, isGraded: true, score }
  }
  if (ms === 'graded' || ms === 'finished') {
    const score = it.myScore != null ? String(it.myScore) : ''
    return {
      statusText: it.myScore != null ? '已批改 · ' + it.myScore : '已批改',
      badge: 'badge-success', editable: false, isGraded: true, score
    }
  }
  // submitted / queued / grading / manual
  return { statusText: '已提交 · 批改中', badge: 'badge-info', editable: false, isGraded: false, score: '' }
}

/** 截止时间 → 「YYYY-MM-DD HH:mm」 */
function fmtFull(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 16) : '—'
}

/** 当前时间 → ISO 本地格式（startTime 传给后端做限时基准） */
function nowIso() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

Page({
  data: {
    hw: null,        // 当前作业详情
    editable: false, // 是否可提交（待提交 / 退回状态）
    answer: '',      // 兜底文本作答（作业无题目时使用）
    eq: [],          // 待提交态的题目列表（含作答状态）
    answered: 0,     // 已作答题数
    loading: true
  },

  onLoad(options) {
    const o = options || {}
    this.assignmentId = Number(o.id || 0)
    this.submissionId = null  // 提交后由表 3-6 返回，供申诉使用
    this.startTime = nowIso()
    if (!this.assignmentId) {
      wx.showToast({ title: '缺少作业参数', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.load()
  },

  /** 表 3-5：从作业列表中定位本条作业 */
  async load() {
    this.setData({ loading: true })
    try {
      const data = await api.homework.list({ page: 1, pageSize: 100 })
      const it = (((data && data.list) || []).filter(x => x.assignmentId === this.assignmentId))[0]
      if (!it) {
        this.setData({ loading: false })
        wx.showToast({ title: '作业不存在或已删除', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      const st = mapStatus(it)
      this.item = it
      // 表 3-5 列表已返回 mySubmissionId：已提交过的作业可直接用于表 3-7 申诉
      this.submissionId = it.mySubmissionId != null ? it.mySubmissionId : null
      this.setData({
        loading: false,
        hw: {
          title: it.title || '未命名作业',
          course: it.courseName || '',
          totalScore: it.totalScore,
          deadline: fmtFull(it.deadline),
          statusText: st.statusText,
          badge: st.badge,
          score: st.score,
          // 申诉入口：仅「已批改且作业允许申诉且当前不在申诉中」时展示
          appealable: st.isGraded && !!it.allowAppeal && it.myStatus !== 'appealing'
        },
        // 原型：待提交 / 退回状态展示编辑区；其余为只读态
        editable: st.editable,
        answer: ''
      })
      wx.setNavigationBarTitle({ title: it.title || '提交详情' })
      if (st.editable) {
        // 待提交 / 退回：拉取试卷题面（题面 + 选项，不含答案）
        this.loadPaper()
      } else if (this.submissionId != null) {
        // 已提交过：拉取提交详情（逐题作答 / 答案 / 对错 / 评语）
        this.loadDetail()
      }
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  /** GET /api/v1/submissions/{id}：填充只读态的批改得分 / 逐题明细 / 评语 */
  async loadDetail() {
    try {
      const d = await api.homework.detail(this.submissionId)
      if (!d) return
      const graded = !!d.graded
      const questions = (d.questions || []).map((q, i) => ({
        q: (i + 1) + '. [' + (q.typeText || '题目') + '] ' + (q.content || ''),
        options: (q.options || []).map((o) => (o.key != null ? o.key + '. ' : '') + (o.text || o)),
        myAnswer: this.fmtAnswer(q.myAnswer),
        standardAnswer: graded ? this.fmtAnswer(q.standardAnswer) : '',
        correct: graded ? q.correct : null,   // null=批改中不展示对错
        gotScore: q.gotScore != null ? q.gotScore : '',
        maxScore: q.maxScore != null ? q.maxScore : '',
        analysis: graded ? (q.analysis || '') : ''
      }))
      this.setData({
        hw: Object.assign({}, this.data.hw, {
          aiScore: d.aiScore != null ? d.aiScore : '',
          teacherScore: d.teacherScore != null ? d.teacherScore : '',
          questions: questions.length ? questions : '',
          comment: d.comment || ''
        })
      })
    } catch (e) {
      // 详情拉取失败不阻塞页面（列表态仍可用）
    }
  },

  /** GET /api/v1/assignments/{id}/questions：填充待提交态的题目与选项 */
  async loadPaper() {
    try {
      const qs = (await api.homework.questions(this.assignmentId)) || []
      const eq = qs.map((q) => {
        let options = (q.options || []).map((o) => ({ key: o.key, text: o.text, sel: false }))
        if (!options.length && q.qType === 'judge') {
          // 判断题后端无 options：前端固定「正确 / 错误」两项
          options = [{ key: '正确', text: '正确', sel: false }, { key: '错误', text: '错误', sel: false }]
        }
        return {
          questionId: q.questionId,
          type: q.qType,
          typeText: q.typeText || '题目',
          content: q.content || '',
          options: options,
          maxScore: q.maxScore != null ? q.maxScore : '',
          ans: ''     // 单选/判断 = 选项 key；多选 = key 数组；其余 = 文本
        }
      })
      this.setData({ eq })
      this.refreshProgress()
    } catch (e) {
      // 题面拉取失败不阻塞页面（兜底文本作答仍可用）
    }
  },

  /** 点选选项：单选/判断互斥选中，多选可多选 */
  onOptionTap(e) {
    const i = Number(e.currentTarget.dataset.index)
    const key = String(e.currentTarget.dataset.key)
    const q = this.data.eq[i]
    if (!q) return
    if (q.type === 'multiple') {
      q.options = q.options.map((o) => (o.key === key ? { key: o.key, text: o.text, sel: !o.sel } : o))
      q.ans = q.options.filter((o) => o.sel).map((o) => o.key)
    } else {
      q.options = q.options.map((o) => ({ key: o.key, text: o.text, sel: o.key === key }))
      q.ans = key
    }
    this.setData({ ['eq[' + i + ']']: q })
    this.refreshProgress()
  },

  /** 文本题（填空/简答/论述/编程）输入 */
  onQInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ ['eq[' + i + '].ans']: e.detail.value })
    this.refreshProgress()
  },

  /** 已作答进度：底部操作条展示 */
  refreshProgress() {
    const eq = this.data.eq || []
    const answered = eq.filter((q) => {
      if (Array.isArray(q.ans)) return q.ans.length > 0
      return q.ans != null && String(q.ans).trim() !== ''
    }).length
    this.setData({ answered, total: eq.length })
  },

  /** 作答值 → 展示文本（选项 key/文本/对象统一转字符串） */
  fmtAnswer(v) {
    if (v == null) return '（未作答）'
    if (Array.isArray(v)) return v.map((x) => this.fmtAnswer(x)).join('、')
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  },

  /** 绑定文本作答输入 */
  onAnswerInput(e) {
    this.setData({ answer: e.detail.value })
  },

  /** 上传附件 —— 后端暂无作业附件上传接口（表 3-6 仅接收 attachment 路径字符串） */
  uploadAttachment() {
    wx.showToast({ title: '附件上传暂未开放', icon: 'none' })
  },

  /** 暂存草稿 —— 后端暂无草稿接口 */
  saveDraft() {
    wx.showToast({ title: '草稿暂存暂未开放', icon: 'none' })
  },

  /** 提交作业（表 3-6）：
   *  有题目时 answers 为 [{questionId, answer}]（客观题 answer = 选项 key，多选为数组，文本题为内容）；
   *  无题目作业退回旧口径（整段文本）。提交成功后整页刷新为只读态。 */
  submit() {
    const hw = this.data.hw
    const eq = this.data.eq || []
    let answers
    if (eq.length) {
      const missing = eq.findIndex((q) => {
        if (Array.isArray(q.ans)) return q.ans.length === 0
        return q.ans == null || String(q.ans).trim() === ''
      })
      if (missing >= 0) {
        wx.showToast({ title: '第 ' + (missing + 1) + ' 题未作答', icon: 'none' })
        return
      }
      answers = eq.map((q) => ({ questionId: q.questionId, answer: q.ans }))
    } else {
      const answer = (this.data.answer || '').trim()
      if (!answer) { wx.showToast({ title: '请输入作答内容', icon: 'none' }); return }
      answers = [{ answer: answer }]
    }
    wx.showModal({
      title: '提交作业',
      content: '确定提交《' + hw.title + '》？提交后不可修改。',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        try {
          const result = await api.homework.submit(this.assignmentId, {
            // 表 3-6：answers 为 [{questionId, answer}] 数组（此前误传 JSON 字符串）
            answers: answers,
            startTime: this.startTime
          })
          wx.hideLoading()
          this.submissionId = (result && result.submissionId) || null
          wx.showToast({ title: '已提交！教师批改中', icon: 'none' })
          // 整页刷新：列表口径切到「已提交」，再由 loadDetail 拉逐题明细
          this.setData({ eq: [], answer: '' })
          this.load()
        } catch (e) {
          // request 层已 toast（逾期不可提交 / 未选课等）
          wx.hideLoading()
        }
      }
    })
  },

  /** 发起成绩申诉（表 3-7，UI 设计 7.9：页面底部「申诉」入口）。
   *  submissionId 来自表 3-5 的 mySubmissionId（本会话内新提交的作业由表 3-6 返回值兜底）。 */
  appeal() {
    if (this.submissionId == null) {
      wx.showToast({ title: '未找到提交记录，暂无法申诉', icon: 'none' })
      return
    }
    wx.showModal({
      title: '成绩申诉',
      editable: true,
      placeholderText: '请填写申诉理由（≤500 字）',
      success: async (res) => {
        if (!res.confirm) return
        const reason = (res.content || '').trim()
        if (!reason) { wx.showToast({ title: '请填写申诉理由', icon: 'none' }); return }
        try {
          // 后端 Appeal BO 字段为 appealReason（表 3-7）
          const r = await api.homework.appeal(this.submissionId, { appealReason: reason })
          wx.showToast({ title: (r && r.message) || '申诉已提交', icon: 'none' })
          this.setData({
            'hw.statusText': '申诉处理中',
            'hw.badge': 'badge-error',
            'hw.appealable': false
          })
        } catch (e) {
          // request 层已 toast（仅已批改且未申诉过的提交可发起）
        }
      }
    })
  }
})
