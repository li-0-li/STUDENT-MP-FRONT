// 添加课程 —— 原型：ui-prototype/mp/app-course-add.html
// 接入：api.course.enroll —— POST /api/v1/courses/{courseId}/enroll（表 3-3）
//   课程码/扫码场景 courseId 传 0、以 courseCode 为准（后端按加课码解析课程）；
//   公开课场景传真实 courseId、enrollType=public；
//   返回 {enrollmentId, status: enrolled/pending}；重复加课 409 由 request 层 toast。
//   api.course.publicCourses —— GET /api/v1/courses/public（is_public=1 且已发布，带 enrolled 标记）
const api = require('../../utils/api')

// 双模式切换 tab（UI 设计 7.5：课程码输入 / 公开课列表）
const MODE_TABS = [
  { key: 'code', label: '课程码加入' },
  { key: 'public', label: '公开课列表' }
]

Page({
  data: {
    mode: 'code', // 当前模式：code / public
    tabs: MODE_TABS.map(t => ({ key: t.key, label: t.label, active: t.key === 'code' })),
    code: '',
    results: [],   // 课程码搜索结果（卡片列表）
    searched: false,
    publicCourses: [],
    publicLoaded: false,  // 公开课列表是否已拉到（未到时显示 loading，失败也置 true 以显示空态）
    publicEmpty: false
  },

  onLoad() {
    this.loadPublic()
  },
  onCodeInput(e) { this.setData({ code: e.detail.value.toUpperCase() }) },

  /** 双模式切换 */
  switchMode(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.mode) return
    this.setData({
      mode: key,
      tabs: MODE_TABS.map(t => ({ key: t.key, label: t.label, active: t.key === key }))
    })
  },

  /** 表 3-3 提交加课；status=enrolled 直接加入，pending 需教师确认
   *  courseId：公开课传真实课程 ID，课程码/扫码场景传 0（后端按 courseCode 解析） */
  async submitEnroll(courseId, body) {
    try {
      const data = await api.course.enroll(courseId || 0, body)
      const status = data && data.status
      wx.showToast({
        title: status === 'enrolled' ? '已加入课程' : '已提交申请，教师确认后生效',
        icon: 'success'
      })
    } catch (e) {
      // request 层已 toast（课程码不存在 404 / 已选过 409 等）
    } finally {
      setTimeout(() => wx.navigateBack(), 900)
    }
  },

  /** 按课程码搜索课程（结果在下方列表展示，逐卡加入） */
  async searchByCode() {
    const v = this.data.code.trim()
    if (!/^[A-Z0-9]{6}$/.test(v)) {
      return wx.showToast({ title: '课程码格式不正确：应为 6 位大写字母或数字（如 NK463D）', icon: 'none' })
    }
    try {
      const list = (await api.course.search({ courseCode: v })) || []
      this.setData({
        searched: true,
        results: list.map((c) => ({
          courseId: c.courseId,
          name: c.courseName,
          teacher: c.teacherName,
          count: c.studentCount != null ? c.studentCount : 0,
          code: c.courseCode
        }))
      })
      if (!list.length) wx.showToast({ title: '未找到该课程码对应的课程', icon: 'none' })
    } catch (e) {
      // request 层已 toast
    }
  },

  /** 搜索结果卡片的「加入」：走表 3-3 加课（审核中的课由后端拦截提示） */
  joinCourse(e) {
    const item = this.data.results[Number(e.currentTarget.dataset.index)]
    if (!item) return
    this.submitEnroll(0, { enrollType: 'code', courseCode: item.code })
  },

  /** 公开课列表：GET /api/v1/courses/public（is_public=1 且已发布，带 enrolled 标记） */
  async loadPublic() {
    try {
      const list = (await api.course.publicCourses()) || []
      this.setData({
        publicLoaded: true,
        publicEmpty: !list.length,
        publicCourses: list.map((c) => {
          const count = c.studentCount != null ? c.studentCount : 0
          return {
            courseId: c.courseId,
            name: c.courseName || '未命名课程',
            // 学校名可能为空，拼好再交给模板，避免模板里出现空的分隔符
            meta: [c.teacherName || '—', c.schoolName, count + ' 人在学']
              .filter(function (s) { return s }).join(' · '),
            enrolled: !!c.enrolled
          }
        })
      })
    } catch (e) {
      // request 层已 toast；置 loaded 以免一直停在加载态
      this.setData({ publicLoaded: true, publicEmpty: true })
    }
  },

  /** 加入公开课（表 3-3 enrollType=public，按真实 courseId 加入；已加入的不再重复提交） */
  joinPublic(e) {
    const c = this.data.publicCourses[Number(e.currentTarget.dataset.index)]
    if (!c || c.enrolled) return
    this.submitEnroll(c.courseId, { enrollType: 'public' })
  },

  scanQr() {
    wx.scanCode({
      success: (res) => {
        // 二维码内容即课程码（与教师端二维码格式对齐：6 位大写字母或数字）
        const code = String(res.result || '').trim().toUpperCase()
        if (!/^[A-Z0-9]{6}$/.test(code)) {
          return wx.showToast({ title: '二维码内容不是有效课程码', icon: 'none' })
        }
        this.submitEnroll(0, { enrollType: 'qrcode', courseCode: code })
      },
      fail: () => wx.showToast({ title: '已取消扫码', icon: 'none' })
    })
  }
})
