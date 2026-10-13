// 首页 —— 原型：ui-prototype/mp/app-home.html（UI 设计文档 7.3）
// 结构：学情概览卡（雷达小卡 + 关键指标）→ 今日待办 → 快捷功能宫格 → 继续学习 → 待办任务 → 为你推荐
// 接入（真实接口）：
//   api.user.me      —— 表 2-14 当前用户（欢迎语姓名）
//   scheduleApi.mine —— 表 3-12 课表（按 classTime 当天过滤出今日课程）
//   aiApi.profile    —— 表 3-11 学情画像（雷达小卡 + 本周学习/已掌握知识点）
//   aiApi.recommend  —— 表 3-19 薄弱点推荐（为你推荐卡）
//   homeworkApi.list —— 表 3-5 作业列表（待办任务 + 截止今日的作业计入今日待办）
// tabBar 页必须 wx.switchTab（不能带参数），其余页面用 wx.navigateTo
const api = require('../../utils/api')

const TAB_PAGES = [
  '/pages/home/home',
  '/pages/courses/courses',
  '/pages/schedule/schedule',
  '/pages/messages/messages',
  '/pages/profile/profile'
]

// 秒 → 「x.xh」展示（>=10h 取整）
function fmtHours(sec) {
  if (!sec) return '0h'
  const h = sec / 3600
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h'
}

// 本地日期 YYYY-MM-DD（与后端 classTime 的日期前缀比对）
function todayStr() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function setStat(stats, key, value) {
  return stats.map((s) => (s.key === key ? Object.assign({}, s, { value }) : s))
}

Page({
  data: {
    name: '',
    greeting: '你好',
    // 学情概览：关键学习指标（等待接口回填）
    learnStats: [
      { key: 'week', label: '本周学习', value: '—' },
      { key: 'mastered', label: '已掌握知识点', value: '—' },
      { key: 'todo', label: '今日待办', value: '—' }
    ],
    // 掌握度雷达数据（ai.profile.kpList → {name, value 0-100}）
    radar: [],
    // 今日待办（今日课程 + 截止今天的作业）
    todayTodos: [],
    // 快捷功能宫格（按 7.3：AI 答疑 / 上课入口 / 添加课程 / 消息）
    quicks: [
      { icon: '✨', label: 'AI 答疑', url: '/pages/ai/ai' },
      { icon: '📺', label: '上课入口', url: '/pages/live/live' },
      { icon: '➕', label: '添加课程', url: '/pages/course-add/course-add' },
      { icon: '💬', label: '消息', url: '/pages/messages/messages' }
    ],
    // 继续学习（暂无「最近学习资源」接口，无数据时整块隐藏）
    continueLearn: null,
    // 待办任务（homeworkApi.list 中未提交的作业）
    tasks: [],
    // 为你推荐（aiApi.recommend 第一条）
    recommend: { title: '暂无推荐', desc: '完成更多练习后，AI 会为你生成个性化学习建议' }
  },

  onLoad() {
    const h = new Date().getHours()
    const greeting = h < 6 ? '凌晨好' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'
    this.setData({ greeting })
    this.loadAll()
  },

  async loadAll() {
    const [me, schedules, courses] = await Promise.all([
      api.user.me().catch(() => null),
      api.schedule.mine().catch(() => null),
      api.course.listMine({ page: 1, pageSize: 50 }).catch(() => null)
    ])

    // users/me（表 2-14）返回的姓名字段是 nickName（若依口径）
    const name = (me && (me.nickName || me.name || me.username)) || '同学'
    const today = todayStr()
    const weekList = Array.isArray(schedules) ? schedules : []
    const todayItems = weekList.filter((it) => (it.classTime || '').indexOf(today) === 0)

    // 今日课程 → 今日待办（课程条目）
    const todayCourses = todayItems.map((it) => ({
      id: 'sch-' + it.scheduleId,
      type: '课程',
      name: it.courseName || '未命名课程',
      course: (it.teacherName || '') + (it.classroomName ? ' · ' + it.classroomName : ''),
      deadline: (it.startTime || '') + '-' + (it.endTime || '') + ' · ' + (it.periodName || ''),
      statusText: it.status === 'ongoing' ? '进行中' : it.status === 'canceled' ? '已取消' : '待上课',
      badge: it.status === 'ongoing' ? 'badge-success' : it.status === 'canceled' ? 'badge-neutral' : 'badge-warning',
      url: '/pages/schedule/schedule'
    }))

    this.setData({ name, todayTodos: todayCourses })

    // 主课程候选（画像/推荐的课程范围）：今日课程 → 本周课表 → 我学的课，去重后取前 5 门；
    // 画像见 loadInsight——候选第一条可能恰是还没有练习记录的课，直接用会导致雷达/已掌握/推荐全空
    const myCourses = (courses && courses.list) || []
    const seen = {}
    const candidates = []
    ;[todayItems[0], weekList[0]].concat(myCourses.slice(0, 5)).forEach((it) => {
      const cid = it && it.courseId
      if (cid && !seen[cid]) {
        seen[cid] = true
        candidates.push(cid)
      }
    })

    this.loadTasks(today, todayCourses)
    if (candidates.length) this.loadInsight(candidates)
    else this.setData({ learnStats: setStat(this.data.learnStats, 'mastered', '—'), radar: [] })
  },

  // 待办任务（未提交作业）+ 截止今天的作业并入今日待办
  async loadTasks(today, todayCourses) {
    let pending = []
    try {
      const data = await api.homework.list({ page: 1, pageSize: 50 })
      pending = ((data && data.list) || []).filter((it) => !it.myStatus)
    } catch (e) {
      // request 层已 toast，待办保持课程条目
    }

    const tasks = pending.map((it) => ({
      id: 'hw-' + it.assignmentId,
      title: it.title,
      deadline: '截止 ' + (it.deadline || '').slice(0, 10),
      status: '待提交',
      badge: 'badge-warning',
      url: '/pages/homework/homework'
    }))
    const dueToday = pending
      .filter((it) => (it.deadline || '').indexOf(today) === 0)
      .map((it) => ({
        id: 'hw-' + it.assignmentId,
        type: '作业',
        name: it.title,
        course: it.courseName || '',
        deadline: '今天 ' + (it.deadline || '').slice(11, 16) + ' 截止',
        statusText: '待完成',
        badge: 'badge-warning',
        url: '/pages/homework/homework'
      }))

    const todos = dueToday.concat(todayCourses)
    this.setData({
      tasks,
      todayTodos: todos,
      learnStats: setStat(this.data.learnStats, 'todo', todos.length + ' 项')
    })
  },

  // 学情画像（雷达 + 指标）与 AI 推荐。
  // 候选课程并行查画像，取「知识点数据最全」的一门为主课程：
  // 今日课程/课表/我学的课的第一条可能还没有练习记录（画像为空），盲选会让雷达与推荐全空。
  async loadInsight(candidateIds) {
    let profile = null
    let mainCourseId = null
    const profiles = await Promise.all(
      candidateIds.map((cid) => api.ai.profile(cid).catch(() => null))
    )
    profiles.forEach((p, i) => {
      const n = p && p.kpList ? p.kpList.length : 0
      if (n > 0 && (!profile || n > profile.kpList.length)) {
        profile = p
        mainCourseId = candidateIds[i]
      }
    })

    if (profile) {
      const kpList = profile.kpList || []
      const mastered = kpList.filter((k) => Number(k.percent) >= 60).length
      this.setData({
        radar: kpList.map((k) => ({
          name: k.kpName,
          value: Math.max(0, Math.min(100, Math.round(Number(k.percent) || 0)))
        })),
        learnStats: setStat(
          setStat(this.data.learnStats, 'week', fmtHours(profile.learningTimeSec)),
          'mastered',
          kpList.length ? mastered + '/' + kpList.length : '—'
        )
      })
      // 雷达小卡为 2d canvas，数据就绪后重绘
      wx.nextTick(() => this.drawRadar())
    } else {
      this.setData({ learnStats: setStat(this.data.learnStats, 'mastered', '—') })
    }

    // 推荐用主课程；全部候选都无画像时退回第一个候选（后端会返回「完成一次练习后…」的通用条目）
    const recCourseId = mainCourseId || candidateIds[0]
    try {
      const rec = await api.ai.recommend(recCourseId)
      const items = (rec && rec.list) || []
      const hit = items.filter((i) => i.type === 'basic')[0] || items[0]
      if (hit) {
        this.setData({
          recommend: {
            title: (hit.kpName ? hit.kpName + ' · ' : '') + hit.title,
            desc: hit.desc || ''
          }
        })
      }
    } catch (e) {
      // request 层已 toast，保持默认文案
    }
  },

  // 绘制掌握度雷达小卡（白线风格，适配深色概览卡；数据来自 ai.profile）
  drawRadar() {
    if (!this.data.radar.length) return
    this.createSelectorQuery()
      .select('#radar')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const dpr = wx.getSystemInfoSync().pixelRatio || 2
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)

        const W = res[0].width, H = res[0].height
        const cx = W / 2, cy = H / 2 + 2
        const R = Math.min(W, H) / 2 - 8
        const N = this.data.radar.length
        const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N
        const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]

        // 网格（3 层，白色半透明）
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.lineWidth = 1
        for (let lv = 1; lv <= 3; lv++) {
          ctx.beginPath()
          for (let i = 0; i <= N; i++) {
            const [x, y] = pt(i % N, (R * lv) / 3)
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        // 轴线
        for (let i = 0; i < N; i++) {
          const [x, y] = pt(i, R)
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
        }
        // 数据多边形
        ctx.beginPath()
        this.data.radar.forEach((d, i) => {
          const [x, y] = pt(i, (R * d.value) / 100)
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        })
        ctx.closePath()
        ctx.fillStyle = 'rgba(255,255,255,0.28)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // 数据点
        this.data.radar.forEach((d, i) => {
          const [x, y] = pt(i, (R * d.value) / 100)
          ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'; ctx.fill()
        })
      })
  },

  // 跳转（tabBar 页 switchTab，其余 navigateTo）
  go(e) {
    const url = e.currentTarget.dataset.url
    if (TAB_PAGES.indexOf(url) >= 0) {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  }
})
