// 首页 —— 原型：ui-prototype/mp/app-home.html（UI 设计文档 7.3）
// 结构：欢迎卡 → 今日课程 → 继续学习 → 我的任务 → 为你推荐
// 接入（真实接口）：
//   api.user.me        —— 表 2-14 当前用户（欢迎语姓名）
//   scheduleApi.mine   —— 表 3-12 课表（按 classTime 当天过滤出今日课程）
//   homeworkApi.list    —— 表 3-5 作业列表（待办任务）
//   experimentApi.list —— 实验任务列表（待办任务；含 published_at/sub_status）
//   aiApi.recommend    —— 表 3-19 薄弱点推荐（为你推荐卡）
// tabBar 页必须 wx.switchTab（不能带参数），其余页面用 wx.navigateTo
// 2026-11-24：TAB_PAGES 同步 tabBar 现状（courses 移入"我的"页列表，不再是 tab 页）
const api = require('../../utils/api')

const TAB_PAGES = [
  '/pages/home/home',
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
    // 继续学习（暂无「最近学习资源」接口，无数据时整块隐藏）
    continueLearn: null,
    // 我的任务卡（2026-11-24 收敛回原型方案：只收待处理——未提交/草稿/已退回；逾期可补交也收）
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
      .map((it) => {
        const st = parseTime(it.startTime)
        const et = parseTime(it.endTime) || parseTime(it.classTime)
        // 上课中判定双保险：后端 status 可能滞后，再按「当前时间在起止之间」兜底
        const ongoing = it.status === 'ongoing' || (!!(st && st <= now && et && now < et))
        // 入口提前 20 分钟开放（2026-11-18）：课前 20 分钟 ~ 下课时间内显示「进入课堂」按钮；
        // 已取消的课不显示入口（后端 by-schedule 同口径拒绝）
        const preOpen = !!(st && it.status !== 'canceled'
          && (st.getTime() - 20 * 60000) <= now.getTime() && (!et || now.getTime() < et.getTime()))
        return {
          id: 'sch-' + it.scheduleId,
          // 独立课堂入口（2026-11-18）：保留排课 id，进入课堂按钮按课定向解析各自的课堂会话
          scheduleId: it.scheduleId,
          icon: '📺',
          name: it.courseName || '未命名课程',
          // 与 schedule 页同款：取 ISO 时间的 HH:mm 段
          time: String(it.startTime || '').replace('T', ' ').slice(11, 16)
            + '-' + String(it.endTime || '').replace('T', ' ').slice(11, 16)
            + (it.periodName ? ' · ' + it.periodName : ''),
          place: it.classroomName || '地点待定',
          ongoing: ongoing,
          preOpen: preOpen,
          statusText: ongoing ? '上课中'
            : (preOpen && it.status !== 'canceled' ? '即将开课'
              : it.status === 'canceled' ? '已取消' : '待上课'),
          badge: ongoing ? 'badge-success'
            : (preOpen && it.status !== 'canceled' ? 'badge-warning'
              : it.status === 'canceled' ? 'badge-neutral' : 'badge-warning'),
          url: '/pages/schedule/schedule'
        }
      })

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

  // ③ 我的任务卡：只收「待处理」条目（未提交/草稿/已退回，含逾期可补交），
  //    已提交/批改中/申诉中/已完成不占首页，去作业页查看——原型方案（2026-11-24 收敛）。
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
        // 2026-11-24 收敛回原型方案：首页待办只收"需要学生处理"的——未提交/草稿/已退回；
        // 已提交、批改中、申诉中、已完成的不再占首页（去作业页查看），解决列表过长问题
        if (st && st !== 'draft' && st !== 'returned') return
        const status = st === 'draft' ? '草稿' : st === 'returned' ? '已退回' : '待提交'
        const badge = st === 'returned' ? 'badge-error' : 'badge-warning'
        items.push({
          id: 'hw-' + it.assignmentId,
          type: '作业',
          title: it.title,
          courseName: it.courseName || '',
          publish: parseTime(it.startTime),
          // 排序辅助：截止时间戳、是否已过截止
          _dl: dl.getTime(),
          _overdue: dl < now,
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
        // 2026-11-24 同作业口径：只收未提交/已退回
        if (st && st !== 'REVISION' && st !== 'RETURNED') return
        const status = (st === 'REVISION' || st === 'RETURNED') ? '已退回' : '待提交'
        const badge = status === '已退回' ? 'badge-error' : 'badge-warning'
        items.push({
          id: 'exp-' + it.task_id,
          type: '实验',
          title: it.title,
          courseName: it.course_name || '',
          publish: parseTime(it.published_at),
          // 排序辅助：截止时间戳、是否已过截止
          _overdue: dl < now,
          deadline: '截止 ' + String(it.deadline || '').replace('T', ' ').slice(0, 16) + overText(dl),
          status,
          badge,
          url: '/pages/experiment-detail/experiment-detail?taskId=' + it.task_id
        })
      })
    } catch (e) {
      // request 层已 toast，作业部分照常
    }

    // 排序（2026-11-24 单一待办口径）：已过截止（可补交）在上、截止越早越上
    items.sort((a, b) => {
      if (a._overdue !== b._overdue) return a._overdue ? -1 : 1
      return a._dl - b._dl
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
  },

  /** 进入课堂（独立课堂入口，2026-11-18）：按各课自己的排课 id 解析它自己的课堂会话，
   *  再带 sessionId 跳实时课堂页——不再共用全局 current，多课同窗时不会进错课 */
  async goLive(e) {
    const scheduleId = Number(e.currentTarget.dataset.sid) || 0
    if (!scheduleId) return
    try {
      const r = await api.classroom.sessionBySchedule(scheduleId)
      const d = (r && r.data) || r || {}
      const sid = Number(d.sessionId) || 0
      if (d.sessionStatus === 'no_session' || !sid) {
        wx.showToast({ title: '教师尚未开课，请稍后再来', icon: 'none' })
        return
      }
      if (d.sessionStatus === 'ended') {
        wx.showToast({ title: '本节课已结束', icon: 'none' })
        return
      }
      wx.navigateTo({ url: '/pages/live/live?sessionId=' + sid })
    } catch (err) {
      // 403 未选修 / 422 排课不存在：request 已弹错误提示，这里静默
    }
  }
})
