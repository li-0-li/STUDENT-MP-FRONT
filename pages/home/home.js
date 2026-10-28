// 首页 —— 原型：ui-prototype/mp/app-home.html（UI 设计文档 7.3）
// 结构：欢迎卡 → 今日课程 → 快捷功能宫格 → 继续学习 → 待办任务 → 为你推荐
// 2026-10-28 改版：
//   ① 欢迎卡删除「今日待办/已掌握知识点/掌握度」指标与掌握度六维图（雷达）；
//   ② 「今日待办」改为「今日课程」：当天课表，剔除上课开始时间已过的课（进行中保留），
//      按上课时间升序；展示课程名 + 上课时间 + 上课地点；
//   ③ 「我的作业」卡：全部课程中未到截止时间的作业+实验（已提交未截止的也保留），
//      已过截止但允许逾期提交且未出分的也保留；扁平列表按发布时间排列，
//      可滚动 + 底部「查看全部」进作业页。
// 接入（真实接口）：
//   api.user.me        —— 表 2-14 当前用户（欢迎语姓名）
//   scheduleApi.mine   —— 表 3-12 课表（按 classTime 当天过滤出今日课程）
//   homeworkApi.list    —— 表 3-5 作业列表（待办任务）
//   experimentApi.list —— 实验任务列表（待办任务；含 published_at/sub_status）
//   aiApi.recommend    —— 表 3-19 薄弱点推荐（为你推荐卡）
// tabBar 页必须 wx.switchTab（不能带参数），其余页面用 wx.navigateTo
const api = require('../../utils/api')

const TAB_PAGES = [
  '/pages/home/home',
  '/pages/courses/courses',
  '/pages/schedule/schedule',
  '/pages/messages/messages',
  '/pages/profile/profile'
]

// 本地日期 YYYY-MM-DD（与后端 classTime 的日期前缀比对）
function todayStr() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// 时间字符串 → Date（后端两种格式：'YYYY-MM-DD HH:mm:ss' 或 'YYYY-MM-DDTHH:mm:ss'）；空/非法返回 null
function parseTime(s) {
  if (!s) return null
  const d = new Date(String(s).replace(/-/g, '/').replace('T', ' '))
  return isNaN(d.getTime()) ? null : d
}

Page({
  data: {
    name: '',
    greeting: '你好',
    // 今日课程（当天课表，开始时间已过的剔除、进行中保留，按上课时间升序）
    todayCourses: [],
    // 快捷功能宫格（按 7.3：AI 答疑 / 上课入口 / 添加课程 / 消息）
    quicks: [
      { icon: '✨', label: 'AI 答疑', url: '/pages/ai/ai' },
      { icon: '📺', label: '上课入口', url: '/pages/live/live' },
      { icon: '➕', label: '添加课程', url: '/pages/course-add/course-add' },
      { icon: '💬', label: '消息', url: '/pages/messages/messages' }
    ],
    // 继续学习（暂无「最近学习资源」接口，无数据时整块隐藏）
    continueLearn: null,
    // 我的作业卡（未截止的作业+实验，含已提交未截止；过截止但允许逾期的也保留；按发布顺序）
    todoTasks: [],
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
    // my-schedule 出参为 {currentWeek, list:[排课], termName, ...} —— 排课取 data.list
    const weekList = (schedules && (schedules.list || (Array.isArray(schedules) && schedules))) || []
    const todayItems = weekList.filter((it) => (it.classTime || '').indexOf(today) === 0)

    // ② 今日课程：剔除「已下课」的课 ——
    //    上课开始时间已过但下课时间未到（进行中）保留；未开始的保留；按上课开始时间升序。
    //    schedule.mine 出参：classTime/startTime/endTime 均为完整日期时间（endTime = 开始+时长）
    const now = new Date()
    const todayCourses = todayItems
      .filter((it) => {
        const end = parseTime(it.endTime) || parseTime(it.classTime)
        return !end || end >= now
      })
      // 按上课开始时间升序：先上课的放首位
      .sort((a, b) => {
        const ta = parseTime(a.classTime)
        const tb = parseTime(b.classTime)
        return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0)
      })
      .map((it) => ({
        id: 'sch-' + it.scheduleId,
        icon: '📺',
        name: it.courseName || '未命名课程',
        // 与 schedule 页同款：取 ISO 时间的 HH:mm 段
        time: String(it.startTime || '').replace('T', ' ').slice(11, 16)
          + '-' + String(it.endTime || '').replace('T', ' ').slice(11, 16)
          + (it.periodName ? ' · ' + it.periodName : ''),
        place: it.classroomName || '地点待定',
        statusText: it.status === 'ongoing' ? '进行中' : it.status === 'canceled' ? '已取消' : '待上课',
        badge: it.status === 'ongoing' ? 'badge-success' : it.status === 'canceled' ? 'badge-neutral' : 'badge-warning',
        url: '/pages/schedule/schedule'
      }))

    this.setData({ name, todayCourses })

    // 推荐课程的候选（今日第一门 → 本周第一门 → 我学的课第一门）
    const myCourses = (courses && courses.list) || []
    const candidates = []
    const seen = {}
    ;[todayItems[0], weekList[0]].concat(myCourses.slice(0, 5)).forEach((it) => {
      const cid = it && it.courseId
      if (cid && !seen[cid]) {
        seen[cid] = true
        candidates.push(cid)
      }
    })

    this.loadTasks()
    if (candidates.length) this.loadRecommend(candidates)
  },

  // ③ 我的作业卡：全部课程中未到截止时间的作业 + 实验（已提交未截止的也保留）；
  //    已过截止但「允许逾期提交」且未出分的也保留。扁平列表按发布时间先后排列。
  async loadTasks() {
    const now = new Date()
    const items = []
    const overText = (dl) => dl && dl < now ? '（已过截止，可逾期补交）' : ''
    try {
      const data = await api.homework.list({ page: 1, pageSize: 200 })
      ;(((data && data.list) || [])).forEach((it) => {
        const dl = parseTime(it.deadline)
        // 收录：未截止的；或已过截止但允许逾期提交的（已完成/已批阅的除外）
        if (!dl) return
        const allowLate = dl >= now || it.allowLate === true
        if (!allowLate) return
        // myStatus 值域（McStatus）：finished=已完成(成绩有效) / returned=已退回 /
        // appealing=申诉中 / submitted·queued·grading·manual=批改中(已提交) / 空=待提交
        const st = it.myStatus != null ? String(it.myStatus).toLowerCase() : ''
        let status, badge
        if (!st) { status = '待提交'; badge = 'badge-warning' }
        else if (st === 'finished') { status = '已完成'; badge = 'badge-success' }
        else if (st === 'returned') { status = '已退回'; badge = 'badge-error' }
        else if (st === 'appealing') { status = '申诉中'; badge = 'badge-info' }
        else { status = '已提交'; badge = 'badge-info' }
        if (dl < now && st === 'finished') return // 已过截止且已出分的不收
        items.push({
          id: 'hw-' + it.assignmentId,
          type: '作业',
          title: it.title,
          courseName: it.courseName || '',
          publish: parseTime(it.startTime),
          deadline: '截止 ' + String(it.deadline || '').replace('T', ' ').slice(0, 16) + overText(dl),
          status,
          badge,
          url: '/pages/submission/submission?id=' + it.assignmentId
        })
      })
    } catch (e) {
      // request 层已 toast，实验部分照常
    }
    try {
      const exps = await api.experiment.list()
      ;(Array.isArray(exps) ? exps : []).forEach((it) => {
        const dl = parseTime(it.deadline)
        if (!dl) return
        const allowLate = dl >= now || it.allow_late === true || it.allow_late === 1
        if (!allowLate) return
        // sub_status 大小写不敏感（lab 页同口径）：null=未提交 / GRADED / REVISION(RETURNED)=已退回 / SUBMITTED
        const st = it.sub_status != null ? String(it.sub_status).toUpperCase() : null
        let status, badge
        if (st == null) { status = '待提交'; badge = 'badge-warning' }
        else if (st === 'GRADED') { status = '已批阅'; badge = 'badge-success' }
        else if (st === 'REVISION' || st === 'RETURNED') { status = '已退回'; badge = 'badge-error' }
        else { status = '已提交'; badge = 'badge-info' }
        if (dl < now && st === 'GRADED') return // 已过截止且已批阅的不收
        items.push({
          id: 'exp-' + it.task_id,
          type: '实验',
          title: it.title,
          courseName: it.course_name || '',
          publish: parseTime(it.published_at),
          deadline: '截止 ' + String(it.deadline || '').replace('T', ' ').slice(0, 16) + overText(dl),
          status,
          badge,
          url: '/pages/experiment-detail/experiment-detail?taskId=' + it.task_id
        })
      })
    } catch (e) {
      // request 层已 toast，作业部分照常
    }

    // 按发布时间先后（发布时间为空排最后）
    items.sort((a, b) => {
      const pa = a.publish ? a.publish.getTime() : Infinity
      const pb = b.publish ? b.publish.getTime() : Infinity
      return pa - pb
    })
    this.setData({ todoTasks: items })
  },

  // 为你推荐（表 3-19）：取候选课程第一条的薄弱点推荐第一条
  async loadRecommend(candidateIds) {
    try {
      const rec = await api.ai.recommend(candidateIds[0])
      const list = (rec && rec.list) || []
      const hit = list.filter((i) => i.type === 'basic')[0] || list[0]
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
