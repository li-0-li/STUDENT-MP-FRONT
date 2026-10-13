// 我的学情 —— 原型：ui-prototype/mp/app-analytics.html
// 接入（真实接口）：
//   aiApi.profile    —— 表 3-11 学情画像（掌握度雷达 / 统计卡 / 各课掌握度，逐课查询）
//   aiApi.recommend  —— 表 3-19 薄弱点练习推荐（AI 学习建议 + 推荐练习）
//   aiApi.alerts     —— 表 4-18 预警名单（过滤出本人预警）
//   homeworkApi.list —— 表 3-5 作业列表（作业完成率 + 近次作业成绩折线）
//   api.user.me      —— 表 2-14 当前用户（按 studentId 过滤本人预警）
const api = require('../../utils/api')

// 预警等级 → 展示
const LEVEL_TEXT = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' }
const LEVEL_BADGE = { HIGH: 'badge-error', MEDIUM: 'badge-warning', LOW: 'badge-neutral' }

Page({
  data: {
    loading: true,
    // 顶部统计卡（原型 g3 三卡）
    stats: [
      { label: '平均分', value: '—' },
      { label: '作业完成', value: '—' },
      { label: '班级排名', value: '—', highlight: true }
    ],

    // 知识点掌握度（ai.profile.kpList，weak 判定线 50，与后端一致）
    mastery: [],

    // 近 6 次作业成绩（已批改作业按截止时间排序取后 6 次）
    homework: [],

    // 每门课的学习进度 / 掌握度（逐课调用 ai.profile）
    courses: [],

    // AI 学习建议文案（ai.recommend，失败回退到画像薄弱点）
    adviceText: '正在生成 AI 学习建议…',

    // 学习预警（alerts 中 studentId 为本人的记录，按 reason 去重）
    alerts: []
  },

  onLoad() {
    this.loadAll()
  },

  async loadAll() {
    try {
      const me = await api.user.me().catch(() => null)
      const courseRes = await api.course.listMine({ page: 1, pageSize: 50 }).catch(() => null)
      const homeworkRes = await api.homework.list({ page: 1, pageSize: 50 }).catch(() => null)

      // 各课进度最多展示 10 门（listMine 已取 pageSize 50，5 门装不下时会漏课）
      const courseList = ((courseRes && courseRes.list) || []).slice(0, 10)
      const hwList = ((homeworkRes && homeworkRes.list) || [])
        .slice()
        .sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')))

      // 逐课画像（雷达 / 进度数据源），取知识点数据最全的一门作为主课程
      const profiles = await Promise.all(
        courseList.map((c) => api.ai.profile(c.courseId).catch(() => null))
      )
      let mainIdx = -1
      profiles.forEach((p, i) => {
        const n = p && p.kpList ? p.kpList.length : 0
        if (n > 0 && (mainIdx < 0 || n > profiles[mainIdx].kpList.length)) mainIdx = i
      })
      const mainProfile = mainIdx >= 0 ? profiles[mainIdx] : null
      const mainCourseId = mainIdx >= 0 ? courseList[mainIdx].courseId : null

      // 统计卡：平均分取已批改作业均分（画像 homeworkAvg 暂缺时兜底），完成率取已提交/总数
      const graded = hwList.filter((it) => it.myScore != null)
      const done = hwList.filter((it) => it.myStatus).length
      const avgScore = graded.length
        ? Math.round(graded.reduce((s, it) => s + it.myScore, 0) / graded.length)
        : mainProfile && mainProfile.homeworkAvg != null
          ? Math.round(Number(mainProfile.homeworkAvg))
          : null

      this.setData({
        stats: [
          { label: '平均分', value: avgScore != null ? String(avgScore) : '—' },
          { label: '作业完成', value: hwList.length ? done + '/' + hwList.length : '—' },
          { label: '班级排名', value: (mainProfile && mainProfile.rankText) || '—', highlight: true }
        ],
        // 雷达维度（kpName + percent；weak 与后端判定线一致：<50）
        mastery: mainProfile
          ? mainProfile.kpList.map((k) => ({
              name: k.kpName,
              percent: Math.round(Number(k.percent) || 0),
              weak: Number(k.percent) < 50
            }))
          : [],
        // 近次作业成绩（最多 6 次，横轴标签沿用「作业N」）
        homework: graded.slice(-6).map((it, i) => ({ label: '作业' + (i + 1), score: it.myScore })),
        // 各课进度：learningProgress 暂缺时以掌握度示意，progressText 说明口径
        courses: courseList.map((c, i) => {
          const p = profiles[i]
          const masteryAvg = p && p.masteryAvg != null ? Math.round(Number(p.masteryAvg)) : null
          const progress = p && p.learningProgress != null ? p.learningProgress : (masteryAvg != null ? masteryAvg : 0)
          return {
            name: c.courseName,
            progress,
            mastery: masteryAvg != null ? '掌握度 ' + masteryAvg + '%' : '暂无掌握度数据',
            progressText:
              p && p.learningProgress != null
                ? '已完成 ' + p.learningProgress + '%'
                : masteryAvg != null
                  ? '暂无进度数据，图中为掌握度 ' + masteryAvg + '%'
                  : '暂无数据'
          }
        }),
        loading: false
      })

      // 等首屏布局完成后再取 canvas 节点尺寸
      setTimeout(() => {
        this.drawRadar()
        this.drawTrend()
      }, 100)

      // AI 建议 + 本人预警（失败不影响主体展示，request 层已 toast）
      if (mainCourseId != null) this.loadAdvice(mainCourseId, mainProfile)
      if (me && me.userId != null) this.loadAlerts(me.userId)
    } catch (e) {
      this.setData({ loading: false, adviceText: 'AI 学习建议暂不可用' })
    }
  },

  // AI 学习建议：优先用推荐接口的「基础巩固」条目，失败回退画像薄弱点
  async loadAdvice(courseId, profile) {
    let text = ''
    try {
      const rec = await api.ai.recommend(courseId)
      this.recommend = rec
      this.recommendCourseId = courseId
      const items = (rec && rec.list) || []
      const basic = items.filter((i) => i.type === 'basic')[0] || items[0]
      if (basic) {
        text =
          '「' + basic.kpName + '」掌握度偏低，建议优先完成推荐练习「' + basic.title + '」' +
          (basic.count ? '（' + basic.count + ' 题）' : '') + '，并回看相关课件与微课。'
      }
    } catch (e) {
      // request 层已 toast
    }
    if (!text) {
      const weak = (profile && profile.weakPoints) || []
      text = weak.length
        ? '「' + weak.join('、') + '」掌握度偏低，建议优先复习并完成相关练习。'
        : '暂无薄弱知识点，保持当前学习节奏即可。'
    }
    this.setData({ adviceText: text })
  },

  // 学习预警：只展示本人的记录，同一 reason 去重（列表按日期倒序，保留最新一条）
  async loadAlerts(myId) {
    try {
      const list = await api.ai.alerts()
      const seen = {}
      const mine = []
      ;(list || []).forEach((a) => {
        if (a.studentId !== myId || seen[a.reason]) return
        seen[a.reason] = true
        mine.push({
          alertId: a.alertId,
          levelText: LEVEL_TEXT[a.level] || a.level || '预警',
          badge: LEVEL_BADGE[a.level] || 'badge-neutral',
          reason: a.reason,
          createdAt: a.createdAt
        })
      })
      this.setData({ alerts: mine.slice(0, 5) })
    } catch (e) {
      // request 层已 toast
    }
  },

  // 取 canvas 2d 节点并按 dpr 缩放，返回 { canvas, ctx, w, h }（逻辑像素）
  getCanvasNode(selector) {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .select(selector)
        .fields({ node: true, size: true })
        .exec((res) => {
          const { node, width, height } = res[0]
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio
          node.width = width * dpr
          node.height = height * dpr
          const ctx = node.getContext('2d')
          ctx.scale(dpr, dpr)
          resolve({ ctx, w: width, h: height })
        })
    })
  },

  // ===== 掌握度雷达图（维度数随画像 kpList，对应原型 SVG 雷达）=====
  async drawRadar() {
    const dims = this.data.mastery
    if (!dims.length) return
    const { ctx, w, h } = await this.getCanvasNode('#radar')
    const cx = w / 2
    const cy = h / 2 + 4
    const R = Math.min(w, h) / 2 - 22 // 留出标签空间
    const n = dims.length

    // 多边形顶点：从正上方开始顺时针
    const pt = (i, r) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
    }

    // 网格环（3 层）
    ctx.strokeStyle = '#eef2f3'
    ctx.lineWidth = 1
    for (let ring = 1; ring <= 3; ring++) {
      const r = (R * ring) / 3
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const [x, y] = pt(i % n, r)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // 轴线
    ctx.strokeStyle = '#e3eaec'
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(x, y)
      ctx.stroke()
    }

    // 数据多边形（弱项顶点单独用警示色标注）
    ctx.beginPath()
    dims.forEach((d, i) => {
      const [x, y] = pt(i, (R * d.percent) / 100)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(20,184,166,.18)'
    ctx.fill()
    ctx.strokeStyle = '#0d9488'
    ctx.lineWidth = 2
    ctx.stroke()

    // 顶点圆点 + 数值标注
    dims.forEach((d, i) => {
      const [x, y] = pt(i, (R * d.percent) / 100)
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = d.weak ? '#d97706' : '#0d9488'
      ctx.fill()
    })

    // 维度标签
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#64748b'
    dims.forEach((d, i) => {
      const [x, y] = pt(i, R + 14)
      const label = d.name
      const tw = ctx.measureText(label).width
      // 顶部标签略上移，底部标签略下移，左右标签对齐边界
      let tx = x - tw / 2
      let ty = y + 4
      if (i === 0) ty = y - 2
      if (i === n - 1 || i === Math.floor(n / 2) + 1) ty = y + 12
      ctx.fillText(label, tx, ty)
    })
  },

  // ===== 近 6 次作业成绩折线图（对应原型 SVG 折线）=====
  async drawTrend() {
    const list = this.data.homework
    if (!list.length) return
    const { ctx, w, h } = await this.getCanvasNode('#trend')
    const padL = 14
    const padR = 14
    const padT = 14
    const padB = 22
    const plotW = w - padL - padR
    const plotH = h - padT - padB

    // 坐标轴（y 轴仅一段示意，x 轴为基线）
    ctx.strokeStyle = '#e3eaec'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padL, padT)
    ctx.lineTo(padL, padT + plotH)
    ctx.lineTo(padL + plotW, padT + plotH)
    ctx.stroke()

    // 数据点：x 均分，y 按分数自适应区间（固定 30~100 时，低分/超满分数据会被画到绘图区外）
    const scores = list.map((d) => Number(d.score) || 0)
    let lo = Math.min.apply(null, scores)
    let hi = Math.max.apply(null, scores)
    if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5 } // 分数接近时撑开区间，避免折线压成水平线
    const span = (hi - lo) || 1
    const yOf = (score) => {
      const t = (Math.min(hi, Math.max(lo, Number(score) || 0)) - lo) / span // 先夹回区间再映射
      return padT + (1 - t) * plotH
    }
    const xs = list.map((_, i) => padL + ((i + 0.5) / list.length) * plotW)

    // 折线
    ctx.beginPath()
    xs.forEach((x, i) => (i === 0 ? ctx.moveTo(x, yOf(list[i].score)) : ctx.lineTo(x, yOf(list[i].score))))
    ctx.strokeStyle = '#0d9488'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.stroke()

    // 数据点 + 分数 + 横轴标签
    ctx.font = '9px sans-serif'
    list.forEach((d, i) => {
      const x = xs[i]
      const y = yOf(d.score)
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#0d9488'
      ctx.fill()
      // 分数标在点上方
      ctx.fillStyle = '#64748b'
      const st = String(d.score)
      ctx.fillText(st, x - ctx.measureText(st).width / 2, y - 8)
      // 横轴标签
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(d.label, x - ctx.measureText(d.label).width / 2, padT + plotH + 14)
    })
  },

  // 开始 AI 推荐练习（表 3-19 题号 → questions 拉题 → 弹层作答 → 表 3-26 提交判分回流学情）
  async startPractice() {
    const items = (this.recommend && this.recommend.list) || []
    const ids = []
    items.forEach(function (it) {
      (it.questionIds || []).forEach(function (q) {
        if (ids.indexOf(q) < 0 && ids.length < 10) ids.push(q)
      })
    })
    if (!ids.length) { wx.showToast({ title: '暂无推荐练习', icon: 'none' }); return }
    this.setData({ practiceOpen: true, practiceLoading: true, practiceResult: null })
    try {
      const list = await api.ai.questions(ids)
      const TYPE_TEXT = { single: '单选', multi: '多选', judge: '判断', blank: '填空' }
      const questions = (list || []).map(function (q) {
        let opts = []
        try { opts = q.options ? JSON.parse(q.options) : [] } catch (e) { opts = [] }
        if (q.q_type === 'judge' && !opts.length) {
          opts = [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
        }
        return {
          questionId: q.question_id,
          qtype: q.q_type,
          typeText: TYPE_TEXT[q.q_type] || '问答',
          content: q.content,
          options: opts,
          selected: q.q_type === 'multi' ? [] : '',
          answered: false
        }
      })
      this._practiceStart = Date.now()
      this.setData({ practiceQuestions: questions, practiceLoading: false })
    } catch (e) {
      this.setData({ practiceOpen: false, practiceLoading: false })
      // request 层已 toast
    }
  },

  // 选项点选（单选/判断互斥，多选可增删）
  pickPractice(e) {
    const qi = e.currentTarget.dataset.q
    const key = e.currentTarget.dataset.key
    const q = this.data.practiceQuestions[qi]
    if (!q) return
    if (q.qtype === 'multi') {
      const sel = q.selected.slice()
      const i = sel.indexOf(key)
      if (i < 0) sel.push(key); else sel.splice(i, 1)
      this.setData({
        ['practiceQuestions[' + qi + '].selected']: sel,
        ['practiceQuestions[' + qi + '].answered']: sel.length > 0
      })
    } else {
      this.setData({
        ['practiceQuestions[' + qi + '].selected']: key,
        ['practiceQuestions[' + qi + '].answered']: true
      })
    }
  },

  // 填空题输入
  onBlankAnswer(e) {
    const qi = e.currentTarget.dataset.q
    this.setData({
      ['practiceQuestions[' + qi + '].selected']: e.detail.value,
      ['practiceQuestions[' + qi + '].answered']: !!e.detail.value
    })
  },

  // 提交练习（表 3-26），未答完先确认
  submitPractice() {
    const qs = this.data.practiceQuestions || []
    const unanswered = qs.filter(function (q) { return !q.answered }).length
    if (unanswered > 0) {
      const that = this
      wx.showModal({
        title: '还有 ' + unanswered + ' 题未作答',
        content: '未作答的题不计入成绩，确定提交吗？',
        success: function (res) { if (res.confirm) that.doSubmitPractice() }
      })
    } else {
      this.doSubmitPractice()
    }
  },

  async doSubmitPractice() {
    if (this._practiceSubmitting) return
    this._practiceSubmitting = true
    const qs = this.data.practiceQuestions || []
    const costSec = this._practiceStart ? Math.max(1, Math.round((Date.now() - this._practiceStart) / 1000)) : 0
    const answers = qs
      .filter(function (q) { return q.answered })
      .map(function (q) {
        const ans = q.qtype === 'multi' ? q.selected.slice().sort().join('') : q.selected
        return { questionId: q.questionId, answer: ans, costSec: costSec }
      })
    if (!answers.length) {
      this._practiceSubmitting = false
      wx.showToast({ title: '请先作答', icon: 'none' })
      return
    }
    try {
      const res = await api.ai.submitPractice({ courseId: this.recommendCourseId, answers: answers })
      this.setData({
        practiceResult: {
          correct: res && res.correctCount != null ? res.correctCount : 0,
          total: res && res.totalCount != null ? res.totalCount : answers.length
        }
      })
      // 作答已回流，重算掌握度刷新雷达与建议
      this.loadAll()
    } catch (e) {
      // request 层已 toast
    }
    this._practiceSubmitting = false
  },

  closePractice() {
    this.setData({ practiceOpen: false })
  },

  // 错题本入口：拉取真实错题记录（表 3-8 关联），按课程归类弹层展示
  async goWrongBook() {
    if (this.data.wrongLoading) return
    this.setData({ wrongOpen: true, wrongLoading: true })
    try {
      const res = await api.homework.wrongRecords()
      const list = (res && res.list) || []
      // 按课程归类
      const map = {}
      const groups = []
      list.forEach(function (r) {
        const key = r.courseId
        if (!map[key]) {
          map[key] = { courseId: key, courseName: r.courseName || '未知课程', items: [] }
          groups.push(map[key])
        }
        map[key].items.push({
          errorId: r.errorId,
          content: r.content || '',
          analysis: r.analysis || '',
          wrongCount: r.wrongCount || 1,
          mastered: !!r.mastered,
          lastWrongTime: (r.lastWrongTime || '').slice(0, 10)
        })
      })
      this.setData({ wrongGroups: groups, wrongLoading: false })
    } catch (e) {
      this.setData({ wrongOpen: false, wrongLoading: false })
      // request 层已 toast
    }
  },

  closeWrongBook() {
    this.setData({ wrongOpen: false })
  },

  noop() {}
})
