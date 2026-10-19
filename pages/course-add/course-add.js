// 添加课程 —— 原型：ui-prototype/mp/app-course-add.html
// 接入：api.course.enroll —— POST /api/v1/courses/{courseId}/enroll（表 3-3）
//   课程码/扫码场景 courseId 传 0、以 courseCode 为准（后端按加课码解析课程）；
//   返回 {enrollmentId, status: enrolled/pending}；重复加课 409 由 request 层 toast。
const api = require('../../utils/api')

// TODO 联调：公开课列表接口不在 M-B 的 13 接口内，enroll 公开课方式已支持（表 3-3 enrollType=public），
//   以下为静态演示数据，公开课列表接口就绪后替换
const PUBLIC_COURSES = [
  { courseId: 0, name: '离散数学', teacher: '刘老师', school: '数学与统计学院', count: 186 },
  { courseId: 0, name: '操作系统', teacher: '赵老师', school: '计算机学院', count: 232 },
  { courseId: 0, name: '大学物理（上）', teacher: '孙老师', school: '物理学院', count: 420 }
]

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
    publicCourses: PUBLIC_COURSES
  },

  onLoad() {},
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

  /** 表 3-3 提交加课；status=enrolled 直接加入，pending 需教师确认 */
  async submitEnroll(body, okTitle) {
    try {
      const data = await api.course.enroll(0, body)
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
    this.submitEnroll({ enrollType: 'code', courseCode: item.code })
  },

  /** 加入公开课（表 3-3 enrollType=public；演示数据暂以课程码占位） */
  joinPublic(e) {
    const c = this.data.publicCourses[e.currentTarget.dataset.index]
    wx.showToast({ title: '已提交加入申请：' + c.name, icon: 'none' })
    setTimeout(() => wx.navigateBack(), 900)
  },

  scanQr() {
    wx.scanCode({
      success: (res) => {
        // 二维码内容即课程码（与教师端二维码格式对齐：6 位大写字母或数字）
        const code = String(res.result || '').trim().toUpperCase()
        if (!/^[A-Z0-9]{6}$/.test(code)) {
          return wx.showToast({ title: '二维码内容不是有效课程码', icon: 'none' })
        }
        this.submitEnroll({ enrollType: 'qrcode', courseCode: code })
      },
      fail: () => wx.showToast({ title: '已取消扫码', icon: 'none' })
    })
  }
})
