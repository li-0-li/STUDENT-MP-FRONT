// 章节作业 —— 原型：ui-prototype/mp/app-course-detail.html
// 接入（真实接口）：
//   表 3-2 api.course.detail 课程详情（课程信息 + 教学周目录）
//   表 3-5 api.homework.list  本课程作业列表（按 weekNum 挂到对应教学周下，
//              状态/得分取本人提交 myStatus/myScore —— 与「我的作业」页同一数据源）
const api = require('../../utils/api')
const { FILE_BASE_URL } = require('../../utils/config')

/** 截止时间 → 「YYYY-MM-DD」 */
function fmtDate(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 10) : '—'
}

/** 上课时间 → 「MM-DD HH:mm」 */
function fmtClassTime(iso) {
  if (!iso) return ''
  return String(iso).replace('T', ' ').slice(5, 16)
}

/** 排课条目 → 上课安排卡片 */
function mapSchedule(it) {
  const statusMap = {
    normal: '正常',
    ongoing: '进行中',
    canceled: '已取消'
  }
  return {
    scheduleId: it.scheduleId,
    weekdayText: it.weekdayText || '',
    periodNo: it.periodNo || '',
    classTimeText: fmtClassTime(it.classTime),
    durationMin: it.durationMin,
    classroomName: it.classroomName,
    classroomLocation: it.classroomLocation,
    status: it.status,
    statusText: statusMap[it.status] || '正常'
  }
}

/** 表 3-5 作业条目 → 章节下作业卡片（状态口径与「我的作业」页一致） */
function mapHomework(it) {
  const ms = it.myStatus
  if (ms === 'graded' || ms === 'finished') {
    return {
      id: it.assignmentId,
      chapter: it.weekNum,
      title: it.title || '未命名作业',
      statusText: '已批改',
      badge: 'badge-success',
      meta: '得分：' + (it.myScore != null ? it.myScore : '—') + ' / ' + (it.totalScore || '—')
    }
  }
  if (ms === 'appealing') {
    return {
      id: it.assignmentId, chapter: it.weekNum, title: it.title || '未命名作业',
      statusText: '申诉处理中', badge: 'badge-error', meta: '截止：' + fmtDate(it.deadline)
    }
  }
  if (ms === 'returned') {
    return {
      id: it.assignmentId, chapter: it.weekNum, title: it.title || '未命名作业',
      statusText: '已退回 · 请重交', badge: 'badge-warning', meta: '截止：' + fmtDate(it.deadline)
    }
  }
  if (ms == null || ms === 'draft') {
    return {
      id: it.assignmentId, chapter: it.weekNum, title: it.title || '未命名作业',
      statusText: '待提交', badge: 'badge-warning', meta: '截止：' + fmtDate(it.deadline)
    }
  }
  // submitted / queued / grading / manual
  return {
    id: it.assignmentId, chapter: it.weekNum, title: it.title || '未命名作业',
    statusText: '已提交 · 批改中', badge: 'badge-info', meta: '截止：' + fmtDate(it.deadline)
  }
}

Page({
  data: {
    courseId: 0,
    course: null,   // 表 3-2 课程信息
    intro: null,    // 课程导学 · 说课视频（三重认证 approved；null 时隐藏导学卡片）
    weeks: [],      // 表 3-2 教学周目录（每项含挂载的作业任务）
    schedules: [],  // 上课安排（全部排课）
    schedulePreview: [], // 详情页仅展示前 2 条
    loading: true
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0)
    if (!this.courseId) {
      wx.showToast({ title: '缺少课程参数', icon: 'none' })
      return
    }
    this.load()
  },

  /** 表 3-2 课程详情 + 表 3-5 本课程作业列表（并行），作业按 weekNum 挂到教学周下 */
  async load() {
    this.setData({ loading: true })
    try {
      const [detail, hwRes, scheduleRes] = await Promise.all([
        api.course.detail(this.courseId),
        api.homework.list({ courseId: this.courseId, page: 1, pageSize: 100 }).catch(() => null),
        api.course.schedules(this.courseId).catch(() => [])
      ])
      const course = detail.course || {}
      const weeks = detail.weeks || []
      const homeworks = ((hwRes && hwRes.list) || []).map(mapHomework)
      const schedules = (scheduleRes || []).map(mapSchedule)
      // 详情页卡片只展示前 2 条，其余进入「全部排课」页
      const schedulePreview = schedules.slice(0, 2)

      // 课程导学：说课视频（approved 才返回；绝对地址直用，相对路径拼 FILE_BASE_URL）
      const iv = detail.introVideo
      const intro = iv && iv.fileUrl ? {
        src: /^https?:\/\//.test(iv.fileUrl) ? iv.fileUrl : FILE_BASE_URL + iv.fileUrl,
        durationText: iv.durationSec ? Math.round(iv.durationSec / 60) + ' 分钟' : ''
      } : null

      // 作业挂载：weekNum 匹配到教学周；目录外的作业收进末尾的「其他作业」卡，避免凭空消失
      const byWeek = {}
      const orphans = []
      homeworks.forEach((h) => {
        const wk = weeks.filter((w) => w.weekNum === h.chapter)[0]
        if (wk) {
          const key = String(wk.weekNum)
          ;(byWeek[key] || (byWeek[key] = [])).push(h)
        } else {
          orphans.push(h)
        }
      })

      const weekCards = weeks.map((w) => ({
        weekNum: w.weekNum,
        title: w.title,
        homeworks: byWeek[String(w.weekNum)] || []
      }))
      if (orphans.length) {
        weekCards.push({ weekNum: '', title: '其他作业', homeworks: orphans })
      }

      this.setData({
        intro,
        course: {
          courseName: course.courseName || '未命名课程',
          teacherName: course.teacherName || '教师',
          // 原型状态徽章：进行中 / 已结课
          statusText: course.status === 'ended' ? '已结课' : '进行中',
          badge: course.status === 'ended' ? 'badge-neutral' : 'badge-info',
          courseCode: course.courseCode || '—'
        },
        // UI 设计 7.7：按章节列出学习资源，并在对应章节下挂载作业任务（截止时间与状态）
        weeks: weekCards,
        schedules,
        schedulePreview,
        loading: false
      })
      wx.setNavigationBarTitle({ title: course.courseName || '章节作业' })
    } catch (e) {
      // request 层已 toast（未选课 403 / 401 跳 dev-login）
      this.setData({ loading: false })
    }
  },

  /** 章节资源入口 → 资源查看页 */
  goResources() {
    wx.navigateTo({
      url: '/pages/resource-view/resource-view?courseId=' + this.courseId
    })
  },

  /** 查看全部排课 → 全部排课页 */
  goAllSchedules() {
    const name = (this.data.course && this.data.course.courseName) || ''
    wx.navigateTo({
      url: '/pages/course-schedules/course-schedules?courseId=' + this.courseId
        + '&courseName=' + encodeURIComponent(name)
    })
  },

  /** 作业条目 → 作业提交页 */
  goSubmission(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/submission/submission?id=' + id
    })
  },

  /** 退出课程确认 */
  confirmWithdraw() {
    wx.showModal({
      title: '确认退出课程？',
      content: '退出后将无法查看本课程内容，且需重新加课才能恢复。',
      confirmText: '确认退出',
      confirmColor: '#dc2626',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.doWithdraw()
        }
      }
    })
  },

  /** 执行退出课程 */
  async doWithdraw() {
    wx.showLoading({ title: '退出中...', mask: true })
    let success = false
    try {
      await api.course.withdraw(this.courseId)
      success = true
    } catch (e) {
      // request 层已 toast 错误信息
    } finally {
      wx.hideLoading()
    }
    if (success) {
      wx.showToast({ title: '已退出课程', icon: 'success' })
      // 延迟返回课程列表页
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    }
  }
})
