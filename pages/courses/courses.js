// 我的课程 —— 原型：ui-prototype/mp/app-courses.html
// 接入：api.course.listMine —— GET /api/v1/courses（表 3-1，学生返回「我学的课」）
//   返回 {list:[{courseId,courseName,courseCode,teacherName,semester,studentCount,status}], total,page,pageSize}
const api = require('../../utils/api')

// 后端课程状态（course.status）→ 展示
const STATUS_TEXT = { creating: '创建中', certifying: '认证中', active: '进行中', archived: '已归档' }
const STATUS_BADGE = { creating: 'badge-info', certifying: 'badge-warning', active: 'badge-success', archived: 'badge-neutral' }

// TODO 联调：学时 / 章节数 / 作业数 / 学习进度暂无 M-B 接口（进度统计由 M-D 学情模块、
//   作业数由 M-C 作业模块提供），以下为静态演示值（按原型取值），接口就绪后替换
const DEMO_STATS = [
  { hours: 64, chapterCount: 8, homeworkCount: 6, progress: 67 },
  { hours: 64, chapterCount: 10, homeworkCount: 8, progress: 80 },
  { hours: 48, chapterCount: 5, homeworkCount: 4, progress: 50 },
  { hours: 56, chapterCount: 0, homeworkCount: 0, progress: 0 }
]

function mapCourse(it, idx) {
  return Object.assign({
    courseId: it.courseId,
    name: it.courseName || '未命名课程',
    teacher: it.teacherName || '',
    semester: it.semester || '',
    studentCount: it.studentCount || 0,
    status: it.status || '',
    statusText: STATUS_TEXT[it.status] || it.status || '',
    statusBadge: STATUS_BADGE[it.status] || 'badge-info'
  }, DEMO_STATS[idx % DEMO_STATS.length])
}

Page({
  data: { courses: [], loading: true },

  onLoad() { this.loadCourses() },
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
