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

// 课程学习进度三态 → 标签样式类
const STATUS_CLASS = {
  completed: 'st-completed',
  in_progress: 'st-progress',
  not_started: 'st-not-started'
}

// 薄弱判定线，与后端 KpMastery.weak() 一致：<50
const WEAK_LINE = 50

/** 本周学习时长（秒）→ 可读文案 */
function formatStudyTime(profile) {
  const sec = profile ? Number(profile.learningTimeSec || 0) : 0
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分钟'
}

/**
 * 知识点掌握度 → 雷达条目 + 评估依据。
 *
 * 后端返回的 percent 不是凭空给的分，而是「作答记录里的历史正确率」。
 * 这里把算它的原始样本（作答次数、答对次数、最近练习日期）一并展示，
 * 让雷达图上每个数字都能回答「凭什么是这个值」。
 */
function buildMastery(profile) {
  const list = (profile && profile.kpList) || []
  return list.map(function (k) {
    const percent = Math.round(Number(k.percent) || 0)
    const total = Number(k.exerciseCount || 0)
    const correct = Number(k.correctCount || 0)
    return {
      name: k.kpName,
      percent: percent,
      weak: percent < WEAK_LINE,
      exerciseCount: total,
      correctCount: correct,
      wrongCount: Math.max(0, total - correct),
      lastPracticedAt: k.lastPracticedAt || '',
      basisText: total > 0
        ? '已作答 ' + total + ' 次 · 答对 ' + correct + ' 次'
          + (k.lastPracticedAt ? ' · 最近练习 ' + k.lastPracticedAt : '')
        : '暂无作答数据'
    }
  })
}

Page({
  data: {
    loading: true,
    // 顶部统计卡（作业维度概览）
    stats: [
      { label: '平均分', value: '—' },
      { label: '作业完成', value: '—' },
      { label: '本周学习', value: '—' }
    ],

    // 班级排名（profiles/me.rank：名次 / 班级人数 / 超越百分比 / 均分对比 / 口径）
    rank: null,

    // 知识点掌握度（kpList + 评估依据：作答数 / 答对数 / 最近练习日期）
    mastery: [],

    // 近 6 次作业成绩（已批改作业按截止时间排序取后 6 次）
    homework: [],

    // 课程选择：掌握度 / 作业成绩 / AI 建议都按所选课程展示
    // （这三样本来就是按课程算的，混在一起展示拼出来的是一份假画像）
    courseNames: [],
    courseIndex: 0,

    // 课程学习进度（GET /v1/profiles/me/courses：三态 + 作业完成率 + 掌握度）
    courseProgressList: [],
    courseStat: null,       // {total, completed, inProgress, notStarted, avgProgress}

    // AI 学习建议文案（ai.recommend，失败回退到画像薄弱点）
    adviceText: '正在生成 AI 学习建议…',

    // 学习预警（alerts 中 studentId 为本人的记录，按 reason 去重）
    alerts: [],

    /* ---- 错题本（GET /api/v1/wrong-records）----
       支持学科(课程) / 错误类型(题型) / 掌握状态 / 时间范围 筛选 + 分页加载，
       后端只返回当前登录用户自己的错题，前端不传 studentId。 */
    wrongOpen: false,
    wrongLoading: false,
    wrongLoaded: false,   // 是否拉过第一页（避免每次开弹层都重拉）
    wrongError: '',
    wrongItems: [],       // 累积的错题行（分页追加）
    wrongGroups: [],      // 按课程归类后的展示结构
    wrongTotal: 0,
    wrongPage: 1,
    wrongHasMore: false,
    // 筛选项（首项均为「全部」）
    wrongCourseOptions: [],   // [{courseId, courseName}]，courseId=null 表示全部课程
    wrongCourseIndex: 0,
    wrongTypeOptions: [
      { label: '全部类型', value: '' },
      { label: '单选题', value: 'single' },
      { label: '多选题', value: 'multi' },
      { label: '判断题', value: 'judge' },
      { label: '填空题', value: 'blank' },
      { label: '简答题', value: 'short' },
      { label: '编程题', value: 'program' }
    ],
    wrongTypeIndex: 0,
    wrongMasteredOptions: [
      { label: '全部状态', value: '' },
      { label: '未掌握', value: 'false' },
      { label: '已掌握', value: 'true' }
    ],
    wrongMasteredIndex: 0,
    wrongStart: '',       // yyyy-MM-dd，空表示不限
    wrongEnd: '',
    wrongSynced: false,   // 本次进入页面是否已自动同步过漏记错题

    /* ---- 错题重做弹层 ---- */
    redoOpen: false,
    redoItem: null,        // 当前重做的错题（含题干 / 题型 / 标准答案）
    redoOptions: [],       // 选择题 / 判断题的选项 [{key, text, checked}]
    redoAnswer: '',        // 当前作答（多选为 "A,C"）
    redoResult: null,      // 判分结果 {correct, correctAnswer, analysis, wrongCount, mastered}
    redoSubmitting: false,

    // 推荐练习是否正在准备（拉推荐 + 取题目），用于按钮 loading 与防连点
    practiceStarting: false
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

      // 逐课画像：掌握度 / 班级排名 / 本周学习 / 作业均分都从这里取。
      // 一次全拉，切换课程时不再发请求。
      const profiles = await Promise.all(
        courseList.map((c) => api.ai.profile(c.courseId).catch(() => null))
      )

      this._courseList = courseList
      this._profiles = profiles
      this._hwList = hwList

      // 默认选中「知识点最全」的那门课（都没有知识点就选第一门）
      let mainIdx = 0
      let bestKp = -1
      profiles.forEach((p, i) => {
        const n = p && p.kpList ? p.kpList.length : 0
        if (n > bestKp) {
          bestKp = n
          mainIdx = i
        }
      })
      // 学生手动切过课程就保持他的选择，别在练习提交后的刷新里把他踢回默认课
      const keep = this.data.courseIndex
      const idx = keep >= 0 && keep < courseList.length ? keep : mainIdx

      this.setData({
        courseNames: courseList.map(function (c) {
          return c.name || c.courseName || ('课程 ' + c.courseId)
        }),
        courseIndex: idx,
        loading: false
      })

      this.applyCourse(idx)

      // 课程作业完成进度单独取：三态由后端按「作业完成情况」判定
      this.loadCourseProgress()

      if (me && me.userId != null) this.loadAlerts(me.userId)
    } catch (e) {
      this.setData({ loading: false, adviceText: 'AI 学习建议暂不可用' })
    }
  },

  // 切换课程 → 重新铺掌握度 / 作业成绩 / AI 建议
  onCourseChange(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ courseIndex: idx })
    this.applyCourse(idx)
  },

  /**
   * 把「某一门课」的学情铺到页面上。
   *
   * 掌握度、作业成绩、AI 建议本来就是按课程算的，以前整页只认一个主课程，
   * 把不同课程的数据混着展示 —— 拼出来的是一份不存在的画像。
   */
  applyCourse(idx) {
    const course = (this._courseList || [])[idx]
    if (!course) {
      this.setData({ rank: null, mastery: [], homework: [] })
      return
    }
    const courseId = course.courseId
    const profile = (this._profiles || [])[idx] || null
    // 只统计这门课的作业（作业列表自带 courseId）
    const hwList = (this._hwList || []).filter(function (it) { return it.courseId === courseId })
    const graded = hwList.filter(function (it) { return it.myScore != null })
    const done = hwList.filter(function (it) { return it.myStatus }).length
    const avgScore = graded.length
      ? Math.round(graded.reduce(function (s, it) { return s + Number(it.myScore) }, 0) / graded.length)
      : (profile && profile.homeworkAvg != null ? Math.round(Number(profile.homeworkAvg)) : null)

    // 近六次作业：横轴用作业真名，超过 6 字截断（画布放不下长标题）
    const recent = graded.slice(-6).map(function (it) {
      const name = String(it.title || '作业')
      return {
        label: name.length > 6 ? name.slice(0, 6) + '…' : name,
        fullName: name,
        score: it.myScore
      }
    })

    this.recommendCourseId = courseId
    this.setData({
      stats: [
        { label: '平均分', value: avgScore != null ? String(avgScore) : '—' },
        { label: '作业完成', value: hwList.length ? done + '/' + hwList.length : '—' },
        { label: '本周学习', value: formatStudyTime(profile) }
      ],
      // 名次 / 人数 / 超越百分比 / 均分对比 / 口径 全由后端算好，前端只展示
      rank: (profile && profile.rank) || null,
      mastery: buildMastery(profile),
      homework: recent,
      adviceText: '正在生成 AI 学习建议…'
    })

    // 等布局完成后量 canvas 节点尺寸
    setTimeout(() => {
      this.drawRadar()
      this.drawTrend()
    }, 80)

    this.loadAdvice(courseId, profile)
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

  /**
   * 课程学习进度（GET /v1/profiles/me/courses）。
   *
   * 三态「已完成 / 进行中 / 未开始」由后端按作业完成情况判定；
   * 失败时保留空状态（列表为空 + 汇总为空），不弹应用层错误，避免把整页拖成不可用。
   */
  async loadCourseProgress() {
    try {
      const res = await api.ai.myCourseProgress()
      const list = ((res && res.list) || []).map(function (c) {
        return {
          courseId: c.courseId,
          name: c.courseName,
          status: c.status,
          statusText: c.statusText || '',
          statusClass: STATUS_CLASS[c.status] || 'st-not-started',
          progress: Number(c.progress || 0),
          text: c.text || ''
        }
      })
      this.setData({
        courseProgressList: list,
        courseStat: (res && res.summary) || null
      })
    } catch (e) {
      // request 层已 toast；这里落到空状态，让该区块自己显示「暂无数据」
      this.setData({ courseProgressList: [], courseStat: null })
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
  /**
   * AI 学习建议里的「开始推荐练习」。
   *
   * 原来只能吃 loadAdvice 缓存里的推荐：一旦推荐接口失败或还没回来，点下去就弹一句
   * 「暂无推荐练习」结束。现在改成完整流程 —— 缓存没有就先拉推荐，再取题目、开弹层，
   * 全程有按钮 loading 态，失败也不会把弹层留在半开状态。
   */
  async startPractice() {
    if (this.data.practiceStarting) return
    if (this.recommendCourseId == null) {
      wx.showToast({ title: '暂无可选课程，无法推荐练习', icon: 'none' })
      return
    }
    this.setData({ practiceStarting: true })
    try {
      let items = (this.recommend && this.recommend.list) || []
      if (!items.length) {
        const rec = await api.ai.recommend(this.recommendCourseId)
        this.recommend = rec
        items = (rec && rec.list) || []
      }
      const ids = []
      items.forEach(function (it) {
        (it.questionIds || []).forEach(function (q) {
          if (ids.indexOf(q) < 0 && ids.length < 10) ids.push(q)
        })
      })
      if (!ids.length) {
        wx.showToast({ title: '该课程暂无推荐题目', icon: 'none' })
        return
      }
      this.setData({ practiceOpen: true, practiceLoading: true, practiceResult: null })
      const list = await api.ai.questions(ids)
      // 题型取值来自 question.q_type：single / multi / judge / blank / short / program
      const TYPE_TEXT = {
        single: '单选', multi: '多选', judge: '判断',
        blank: '填空', short: '简答', program: '编程'
      }
      const CHOICE = { single: 1, multi: 1, judge: 1 }
      const questions = (list || []).map(function (q) {
        const qtype = q.q_type
        let opts = []
        try { opts = q.options ? JSON.parse(q.options) : [] } catch (e) { opts = [] }
        if (qtype === 'judge' && !opts.length) {
          opts = [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
        }
        return {
          questionId: q.question_id,
          qtype: qtype,
          typeText: TYPE_TEXT[qtype] || '问答',
          content: q.content,
          // 选中态算在数据里：WXML 表达式不支持 .indexOf() 这类方法调用，
          // 以前把它写在模板里恒为 undefined，点了没有任何视觉反馈
          options: opts.map(function (o) {
            return { key: String(o.key), text: o.text, checked: false }
          }),
          isChoice: !!CHOICE[qtype],
          isMulti: qtype === 'multi',
          isProgram: qtype === 'program',
          // 选择题用字符串/数组存键，主观题用字符串存文本
          selected: qtype === 'multi' ? [] : '',
          answered: false
        }
      })
      this._practiceStart = Date.now()
      this.setData({ practiceQuestions: questions, practiceLoading: false })
    } catch (e) {
      // request 层已 toast；这里把弹层收回，避免停在「加载中」的空壳上
      this.setData({ practiceOpen: false, practiceLoading: false })
    } finally {
      this.setData({ practiceStarting: false })
    }
  },

  // 选项点选（单选/判断互斥，多选可增删）
  pickPractice(e) {
    const qi = e.currentTarget.dataset.q
    const key = e.currentTarget.dataset.key
    const q = this.data.practiceQuestions[qi]
    if (!q) return
    if (q.judged) return   // 已交卷，别再改答案
    if (q.isMulti) {
      const sel = q.selected.slice()
      const i = sel.indexOf(key)
      if (i < 0) sel.push(key); else sel.splice(i, 1)
      this.setData({
        ['practiceQuestions[' + qi + '].selected']: sel,
        ['practiceQuestions[' + qi + '].options']: q.options.map(function (o) {
          return { key: o.key, text: o.text, checked: sel.indexOf(o.key) >= 0 }
        }),
        ['practiceQuestions[' + qi + '].answered']: sel.length > 0
      })
    } else {
      this.setData({
        ['practiceQuestions[' + qi + '].selected']: key,
        ['practiceQuestions[' + qi + '].options']: q.options.map(function (o) {
          return { key: o.key, text: o.text, checked: o.key === key }
        }),
        ['practiceQuestions[' + qi + '].answered']: true
      })
    }
  },

  // 填空 / 简答 / 编程：文本输入（input 与 textarea 共用）
  onTextAnswer(e) {
    const qi = e.currentTarget.dataset.q
    const val = (e.detail.value == null ? '' : String(e.detail.value))
    this.setData({
      ['practiceQuestions[' + qi + '].selected']: val,
      ['practiceQuestions[' + qi + '].answered']: !!val.trim()
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
      // 后端把每题的标准答案与解析一并返回，这里直接回填到题目上：
      // 交完卷当场就能看到哪几题错了、错在哪，不必再翻别处
      const byId = {}
      ;((res && res.results) || []).forEach(function (r) { byId[r.questionId] = r })
      const patched = qs.map(function (q) {
        const r = byId[q.questionId]
        if (!r) return q
        // 多选题的标准答案是 "A,C" 这种写法，去掉分隔符后才能逐项比对
        const rightKeys = String(r.standardAnswer || '').replace(/[,，、\s]/g, '').toUpperCase()
        return Object.assign({}, q, {
          judged: true,
          correct: r.correct === true,
          wrong: r.correct === false,
          // 多选题的答案是 "AC"，拆开给人看更像话
          myAnswer: q.isMulti
            ? String(r.myAnswer || '').split('').join('、')
            : (r.myAnswer || ''),
          standardAnswer: r.standardAnswer || '',
          analysis: r.analysis || '',
          // 交卷后标出正确选项：错在哪一眼就能看到
          options: (q.options || []).map(function (o) {
            return {
              key: o.key,
              text: o.text,
              checked: o.checked,
              right: rightKeys.indexOf(String(o.key).toUpperCase()) >= 0
            }
          })
        })
      })
      // 简答/编程题不参与机器判分（后端 correct 为 null），结果里要说清楚，
      // 否则学生会以为"这几题我明明写了却算错"
      const pending = ((res && res.results) || []).filter(function (r) {
        return r.correct === null || r.correct === undefined
      }).length
      this.setData({
        practiceQuestions: patched,
        practiceResult: {
          correct: res && res.correctCount != null ? res.correctCount : 0,
          total: res && res.totalCount != null ? res.totalCount : answers.length,
          pending: pending
        }
      })
      // 作答已回流，重算掌握度刷新雷达与建议（applyCourse 会保持当前选中课程）
      this.loadAll()
    } catch (e) {
      // request 层已 toast
    }
    this._practiceSubmitting = false
  },

  closePractice() {
    this.setData({ practiceOpen: false })
  },

  /* ===================== 错题本 ===================== */

  // 入口：打开弹层 → 学科下拉 → 拉第一页 → 后台补同步漏记的错题
  async goWrongBook() {
    this.setData({ wrongOpen: true })
    // 同步挪到首屏之后：它只是补偿链路，慢或失败都不该让列表卡在空白页等它
    if (!this.data.wrongCourseOptions.length) {
      await this.loadWrongCourseOptions()
    }
    if (!this.data.wrongLoaded) {
      await this.loadWrong(true)
    }
    if (!this.data.wrongSynced) {
      this.setData({ wrongSynced: true })
      this.syncWrongInBackground()
    }
  },

  /**
   * 后台补一次漏记错题（已批改作业里答错、但因写入链路被绕过而没进错题本的题）。
   * 只有真的补进了新错题才刷新列表；失败不影响已展示内容，下次打开重试。
   */
  async syncWrongInBackground() {
    try {
      const res = await api.homework.syncWrongRecords()
      if (res && res.created > 0) {
        this.loadWrong(true)
      }
    } catch (e) {
      // 静默：已有错题照常展示
    }
  },

  // 学科下拉取「我学的课」，取不到也不阻塞错题查询（只是少了学科筛选项）
  async loadWrongCourseOptions() {
    try {
      const res = await api.course.listMine({ page: 1, pageSize: 50 })
      const list = (res && res.list) || []
      this.setData({
        wrongCourseOptions: [{ courseId: null, courseName: '全部课程' }].concat(
          list.map(function (c) {
            return { courseId: c.courseId, courseName: c.courseName || ('课程' + c.courseId) }
          })
        )
      })
    } catch (e) {
      this.setData({ wrongCourseOptions: [{ courseId: null, courseName: '全部课程' }] })
    }
  },

  /**
   * 拉取错题。reset=true 表示筛选条件变更、从第一页重来；false 为追加下一页。
   * 只传后端支持的 courseId / qType / mastered / startTime / endTime / page / pageSize。
   */
  async loadWrong(reset) {
    // 请求序号：快速切换筛选/翻页时只认最后一次请求的结果。
    // 以前用 wrongLoading 直接 return，会把"加载中又换了筛选条件"的新请求吞掉，
    // 界面停在旧数据上；改为序号比对后，旧响应丢弃、新请求照发。
    const seq = (this._wrongSeq = (this._wrongSeq || 0) + 1)
    const page = reset ? 1 : this.data.wrongPage + 1
    this.setData({ wrongLoading: true, wrongError: '' })

    const course = this.data.wrongCourseOptions[this.data.wrongCourseIndex]
    const type = this.data.wrongTypeOptions[this.data.wrongTypeIndex]
    const mastered = this.data.wrongMasteredOptions[this.data.wrongMasteredIndex]

    const params = { page: page, pageSize: 20 }
    if (course && course.courseId != null) params.courseId = course.courseId
    if (type && type.value) params.qType = type.value
    if (mastered && mastered.value) params.mastered = mastered.value
    if (this.data.wrongStart) params.startTime = this.data.wrongStart
    if (this.data.wrongEnd) params.endTime = this.data.wrongEnd

    try {
      const res = await api.homework.wrongRecords(params)
      // 过期响应直接丢弃（期间又切了筛选条件或翻了页）
      if (seq !== this._wrongSeq) return
      const list = (res && res.list) || []
      const total = (res && res.total) || 0
      const items = reset ? list : this.data.wrongItems.concat(list)
      this.setData({
        wrongItems: items,
        wrongGroups: this.groupWrong(items),
        wrongPage: page,
        wrongTotal: total,
        wrongHasMore: items.length < total,
        wrongLoaded: true,
        wrongLoading: false
      })
    } catch (e) {
      if (seq !== this._wrongSeq) return
      // request 层已 toast；这里给出可自查的具体原因，并保留已加载数据
      this.setData({ wrongLoading: false, wrongError: this.wrongErrorText(e) })
    }
  },

  /**
   * 把失败原因翻译成能自查的文案。
   *
   * 原来一律显示"加载失败，请重试"，无法区分「后端没起」「真机连不上 127.0.0.1」
   * 「登录失效」「业务报错」，排查只能靠猜。
   */
  wrongErrorText(e) {
    const msg = (e && e.message) || String(e || '')
    if (msg.indexOf('request:fail') >= 0 || msg.indexOf('网络') >= 0) {
      return '网络异常：请确认后端已启动且地址可访问（真机不能用 127.0.0.1）'
    }
    if (msg.indexOf('登录') >= 0 || msg.indexOf('401') >= 0) {
      return '登录已失效，请重新登录'
    }
    return msg ? ('加载失败：' + msg) : '加载失败，请点击重试'
  },

  /** 错误态点击重试 */
  retryWrong() {
    this.loadWrong(true)
  },

  // 按课程归类（课程名为空时归到「未分类」），qTypeName 由后端返回，前端不做题型映射
  groupWrong(items) {
    // 回调用 function 声明时 this 不指向 Page 实例，必须先把 this 存下来，
    // 否则回调里的 this.parseOptions 会报 "Cannot read properties of undefined"
    const self = this
    const map = {}
    const groups = []
    items.forEach(function (r) {
      const key = r.courseId != null ? String(r.courseId) : '0'
      if (!map[key]) {
        map[key] = { courseId: key, courseName: r.courseName || '未分类', items: [] }
        groups.push(map[key])
      }
      map[key].items.push({
        errorId: r.errorId,
        content: r.content || '',
        analysis: r.analysis || '',
        wrongCount: r.wrongCount || 1,
        mastered: !!r.mastered,
        qType: r.qType || '',
        qTypeName: r.qTypeName || '',
        answer: r.answer || '',
        options: self.parseOptions(r.options),
        lastWrongTime: (r.lastWrongTime || '').slice(0, 10)
      })
    })
    return groups
  },

  /**
   * 解析题干选项 JSON。
   * 后端原样返回 question.options（形如 [{"key":"A","text":"2"}]），
   * 判断题与填空题该列为 NULL，统一降级为空数组，避免模板里再判 null。
   */
  parseOptions(raw) {
    if (!raw) return []
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr : []
    } catch (e) {
      return []
    }
  },

  onWrongCourseChange(e) {
    this.setData({ wrongCourseIndex: Number(e.detail.value) })
    this.loadWrong(true)
  },

  onWrongTypeChange(e) {
    this.setData({ wrongTypeIndex: Number(e.detail.value) })
    this.loadWrong(true)
  },

  onWrongMasteredChange(e) {
    this.setData({ wrongMasteredIndex: Number(e.detail.value) })
    this.loadWrong(true)
  },

  onWrongStartChange(e) {
    this.setData({ wrongStart: e.detail.value })
    this.loadWrong(true)
  },

  onWrongEndChange(e) {
    this.setData({ wrongEnd: e.detail.value })
    this.loadWrong(true)
  },

  resetWrongFilter() {
    this.setData({
      wrongCourseIndex: 0,
      wrongTypeIndex: 0,
      wrongMasteredIndex: 0,
      wrongStart: '',
      wrongEnd: ''
    })
    this.loadWrong(true)
  },

  loadMoreWrong() {
    if (this.data.wrongHasMore && !this.data.wrongLoading) {
      this.loadWrong(false)
    }
  },

  closeWrongBook() {
    this.setData({ wrongOpen: false })
  },

  /* ---- 删除（二次确认） ---- */
  onDeleteWrong(e) {
    const that = this
    const errorId = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除错题',
      content: '删除后该错题不再出现在错题本，也不再参与学情统计，确定删除吗？',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: function (res) {
        if (res.confirm) {
          that.doDeleteWrong(errorId)
        }
      }
    })
  },

  async doDeleteWrong(errorId) {
    try {
      await api.homework.deleteWrongRecord(errorId)
      const groups = (this.data.wrongGroups || [])
        .map(function (g) {
          return {
            courseId: g.courseId,
            courseName: g.courseName,
            items: (g.items || []).filter(function (q) {
              return String(q.errorId) !== String(errorId)
            })
          }
        })
        .filter(function (g) { return g.items.length })
      this.setData({
        wrongGroups: groups,
        wrongItems: (this.data.wrongItems || []).filter(function (r) {
          return String(r.errorId) !== String(errorId)
        }),
        wrongTotal: Math.max(0, this.data.wrongTotal - 1)
      })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      // request 层已提示
    }
  },

  /* ---- 重做 ---- */
  onRedo(e) {
    const errorId = e.currentTarget.dataset.id
    const item = this.findWrongItem(errorId)
    if (!item) return
    if (item.qType === 'short' || item.qType === 'program') {
      wx.showToast({ title: '主观题暂不支持自动判分', icon: 'none' })
      return
    }
    this.setData({
      redoOpen: true,
      redoItem: item,
      redoOptions: this.buildRedoOptions(item),
      redoAnswer: '',
      redoResult: null,
      redoSubmitting: false
    })
  },

  /**
   * 生成重做选项。
   *
   * 判断题在库里存在两种标准答案形态（老数据「正确/错误」、新数据「A/B」），
   * 提交值必须与标准答案同形态，否则后端 normalizeBoolean 比对会永远判错，
   * 因此按标准答案推断该用字母还是中文。
   */
  buildRedoOptions(item) {
    if (item.qType === 'judge') {
      const letter = /^[AB]$/i.test(String(item.answer || '').trim())
      return [
        { key: letter ? 'A' : '正确', text: '正确', checked: false },
        { key: letter ? 'B' : '错误', text: '错误', checked: false }
      ]
    }
    return (item.options || []).map(function (o) {
      return { key: o.key, text: o.text, checked: false }
    })
  },

  onRedoTapOption(e) {
    const key = e.currentTarget.dataset.key
    const item = this.data.redoItem
    if (!item) return
    const multi = item.qType === 'multi'
    const options = this.data.redoOptions.map(function (o) {
      if (o.key === key) {
        return Object.assign({}, o, { checked: multi ? !o.checked : true })
      }
      return multi ? o : Object.assign({}, o, { checked: false })
    })
    const answer = options
      .filter(function (o) { return o.checked })
      .map(function (o) { return o.key })
      .join(',')
    this.setData({ redoOptions: options, redoAnswer: answer, redoResult: null })
  },

  onRedoInput(e) {
    this.setData({ redoAnswer: e.detail.value, redoResult: null })
  },

  async submitRedo() {
    const item = this.data.redoItem
    if (!item || this.data.redoSubmitting) return
    // 已出结果时再点，是「再试一次」：清空作答重新开始
    if (this.data.redoResult) {
      this.setData({
        redoResult: null,
        redoAnswer: '',
        redoOptions: this.buildRedoOptions(item)
      })
      return
    }
    const answer = (this.data.redoAnswer || '').trim()
    if (!answer) {
      wx.showToast({ title: '请先作答', icon: 'none' })
      return
    }
    this.setData({ redoSubmitting: true })
    try {
      const res = await api.homework.redoWrongRecord(item.errorId, answer)
      const result = res || {}
      this.setData({ redoResult: result, redoSubmitting: false })
      // 后端已把结果写回错题记录，这里只同步本地卡片，避免整表重拉
      this.replaceWrongItem(item.errorId, {
        mastered: !!result.mastered,
        wrongCount: result.wrongCount,
        answer: result.correctAnswer || item.answer,
        analysis: result.analysis || item.analysis
      })
      if (result.correct) {
        wx.showToast({ title: '答对了，已标记掌握', icon: 'success' })
      }
    } catch (err) {
      this.setData({ redoSubmitting: false })
    }
  },

  closeRedo() {
    this.setData({
      redoOpen: false,
      redoItem: null,
      redoOptions: [],
      redoAnswer: '',
      redoResult: null
    })
  },

  /* ---- 局部更新工具 ---- */
  findWrongItem(errorId) {
    const groups = this.data.wrongGroups || []
    for (let i = 0; i < groups.length; i++) {
      const items = groups[i].items || []
      for (let j = 0; j < items.length; j++) {
        if (String(items[j].errorId) === String(errorId)) return items[j]
      }
    }
    return null
  },

  /**
   * 就地更新某条错题（收藏切换、重做后刷新卡片）。
   * 只改展示层，落库已经在后端接口里完成。
   */
  replaceWrongItem(errorId, patch) {
    const groups = (this.data.wrongGroups || []).map(function (g) {
      return {
        courseId: g.courseId,
        courseName: g.courseName,
        items: (g.items || []).map(function (q) {
          return String(q.errorId) === String(errorId) ? Object.assign({}, q, patch) : q
        })
      }
    })
    const items = (this.data.wrongItems || []).map(function (r) {
      return String(r.errorId) === String(errorId) ? Object.assign({}, r, patch) : r
    })
    this.setData({ wrongGroups: groups, wrongItems: items })
  },

  noop() {}
})
