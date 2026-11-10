// 课程详情 —— 原型：ui-prototype/mp/app-course-detail.html
// 2026-11-10 改版：
//   章节目录 → 纯目录子页（course-weeks，只列章节标题，不关联周次）
//   上课安排 → 只展示当前教学周「第 N 周」大卡片（课次小卡片 + 资源挂载，
//              每周一零点随 currentWeek 自然翻周），全部周次进 course-schedules 页
// 数据：表 3-2 课程详情 + week-lessons 周课次聚合 + 作业/实验/资源按 scheduleId 挂载
const api = require('../../utils/api')
const { FILE_BASE_URL } = require('../../utils/config')
const { loadWeekMount, openItem } = require('../../utils/week-mount')

Page({
  data: {
    courseId: 0,
    course: null,   // 表 3-2 课程信息
    intro: null,    // 课程导学 · 说课视频（三重认证 approved；null 时隐藏导学卡片）
    chapterCount: 0, // 章节数（入口卡展示）
    weekLabel: '',      // 当前周大卡片标题：第 N 周（· 周主题）
    weekLessons: [],    // 当前周课次（含挂载资源）
    weekCommon: [],     // 当前周级共用资源（未绑定课次的历史数据）
    weekCount: 0,       // 全部排课总数入口
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

  /** 表 3-2 课程详情 + 周课次聚合（并行）；作业/实验/资源按课次挂载在「上课安排」当前周卡片下 */
  async load() {
    this.setData({ loading: true })
    try {
      const [detail, mount] = await Promise.all([
        api.course.detail(this.courseId),
        loadWeekMount(this.courseId)
      ])
      const course = detail.course || {}
      // 上课安排：只展示当前教学周的大卡片（每周一零点自然翻周，由 currentWeek 推导）
      const cur = mount.currentWeek != null
        ? mount.weeks.find(function (w) { return w.weekNum === mount.currentWeek }) : null
      const weekLessons = cur ? cur.lessons : []
      const weekCommon = cur ? cur.common.items : []

      // 课程导学：说课视频（approved 才返回；绝对地址直用，相对路径拼 FILE_BASE_URL）
      const iv = detail.introVideo
      const intro = iv && iv.fileUrl ? {
        src: /^https?:\/\//.test(iv.fileUrl) ? iv.fileUrl : FILE_BASE_URL + iv.fileUrl,
        durationText: iv.durationSec ? Math.round(iv.durationSec / 60) + ' 分钟' : ''
      } : null

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
        chapterCount: (detail.weeks || []).length,
        weekLabel: cur ? cur.label : '',
        weekLessons: weekLessons,
        weekCommon: weekCommon,
        weekCount: mount.totalLessons,
        loading: false
      })
      wx.setNavigationBarTitle({ title: course.courseName || '章节作业' })
    } catch (e) {
      // request 层已 toast（未选课 403 / 401 跳 dev-login）
      this.setData({ loading: false })
    }
  },

  /** 章节入口 → 章节目录页（周课次 + 作业/实验/资源） */
  goWeeks() {
    const name = (this.data.course && this.data.course.courseName) || ''
    wx.navigateTo({
      url: '/pages/course-weeks/course-weeks?courseId=' + this.courseId
        + '&courseName=' + encodeURIComponent(name)
    })
  },

  // 挂载项点按分发（作业/实验/文件），逻辑见共享模块
  openItem: openItem,

  /** 查看全部排课 → 全部排课页 */
  goAllSchedules() {
    const name = (this.data.course && this.data.course.courseName) || ''
    wx.navigateTo({
      url: '/pages/course-schedules/course-schedules?courseId=' + this.courseId
        + '&courseName=' + encodeURIComponent(name)
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
