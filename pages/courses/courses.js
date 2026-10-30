// 我的课程 —— 原型：ui-prototype/mp/app-courses.html
// 接入：api.course.listMine —— GET /api/v1/courses（表 3-1，学生返回「我学的课」）
//   返回 {list:[{courseId,courseName,courseCode,teacherName,semester,studentCount,status}], total,page,pageSize}
const api = require('../../utils/api')

// 后端课程状态（course.status）→ 展示
const STATUS_TEXT = { creating: '创建中', certifying: '认证中', active: '进行中', archived: '已归档' }
const STATUS_BADGE = { creating: 'badge-info', certifying: 'badge-warning', active: 'badge-success', archived: 'badge-neutral' }

// 课程进度已接入表 3-1 字段 progress（时间口径：首节课 0% → 末节课下课 100%，无排课为 0）
//   章节数/作业数/实验数同为真实字段（chapterCount/homeworkCount/experimentCount，后端实时计数）
function mapCourse(it) {
  return {
    courseId: it.courseId,
    name: it.courseName || '未命名课程',
    teacher: it.teacherName || '',
    semester: it.semester || '',
    studentCount: it.studentCount || 0,
    chapterCount: it.chapterCount || 0,
    homeworkCount: it.homeworkCount || 0,
    experimentCount: it.experimentCount || 0,
    progress: it.progress != null ? it.progress : 0,
    status: it.status || '',
    statusText: STATUS_TEXT[it.status] || it.status || '',
    statusBadge: STATUS_BADGE[it.status] || 'badge-info'
  }
}

Page({
  data: { courses: [], loading: true },

  // onShow 而非 onLoad：切回本页签时自动刷新（教师增删章节/作业后，数字即时更新）
  onShow() { this.loadCourses() },
  onPullDownRefresh() { this.loadCourses().finally(() => wx.stopPullDownRefresh()) },

  async loadCourses() {
    this.setData({ loading: true })
    try {
      const data = await api.course.listMine({ page: 1, pageSize: 50 })
      this.setData({ courses: ((data && data.list) || []).map(mapCourse), loading: false })
    } catch (e) {
      // request 层已 toast（401 会跳 dev-login）
      this.setData({ loading: false })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    // 课程详情（章节作业）页，课程信息/周目录走表 3-2 真实接口，作业列表待 M-C 联调
    wx.navigateTo({ url: '/pages/course-detail/course-detail?courseId=' + id })
  },
  goAddCourse() { wx.navigateTo({ url: '/pages/course-add/course-add' }) }
})
