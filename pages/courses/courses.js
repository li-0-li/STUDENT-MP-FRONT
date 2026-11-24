// 课程页 —— 原型：ui-prototype/mp/app-courses.html
// 2026-11-24 从底部 tabBar 移入「我的」页列表入口；新增按学期筛选（下拉选择器）。
// 接入：api.course.listMine —— GET /api/v1/courses（表 3-1，学生返回「我学的课」）
//   返回 {list:[{courseId,courseName,courseCode,teacherName,semester,studentCount,firstClassTime,...}], total,...}
// 学期口径（产品确认）：按开课时间推导，semester 字段与实际开课时间可能不一致，弃用之：
//   8月-次年1月开课 = 该学年第一学期；2-7月开课 = 该学年第二学期；学年 = 8月起算跨年（如 2026-08 → 2026-2027 学年）
const api = require('../../utils/api')

// 后端课程状态（course.status）→ 展示
const STATUS_TEXT = { creating: '创建中', certifying: '认证中', active: '进行中', archived: '已归档' }
const STATUS_BADGE = { creating: 'badge-info', certifying: 'badge-warning', active: 'badge-success', archived: 'badge-neutral' }

/**
 * 按开课时间推导学期标签（2026-11-24）。
 * @param {string} firstClassTime 后端 firstClassTime（yyyy-MM-dd HH:mm:ss），未排课为 null/undefined
 * @returns {string} 如「2025-2026学年第一学期」「2025-2026学年第二学期」，未排课返回空串
 */
function termOf(firstClassTime) {
  if (!firstClassTime) return ''
  const t = firstClassTime.replace(' ', 'T')
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  const m = d.getMonth() + 1  // 1-12
  const y = d.getFullYear()
  if (m >= 8) return y + '-' + (y + 1) + '学年第一学期'          // 8-12月：新学年第一学期
  if (m === 1) return (y - 1) + '-' + y + '学年第一学期'         // 1月：上一学年第一学期（次年段）
  return (y - 1) + '-' + y + '学年第二学期'                      // 2-7月：上一学年第二学期
}

/**
 * 下拉学期选项（2026-11-24 产品确认）：从五个学年前到当前学期按时间正序排列，
 * 「全部」固定在最底部，其正上方即当前学期（从下往上：全部 → 当前 → 越来越旧）。
 * 当前学期按今天日期推导：8-12月=当学年第一学期；1月=上一学年第一学期；2-7月=上一学年第二学期。
 * @returns {string[]} 如 ['2021-2022学年第一学期', ..., '2026-2027学年第一学期', '全部']
 */
const TERM_YEARS_BACK = 5
function buildTermOptions(now) {
  const d = now || new Date()
  const m = d.getMonth() + 1
  let curSy = m >= 8 ? d.getFullYear() : d.getFullYear() - 1   // 当前学年起始年
  let curT = (m >= 8 || m === 1) ? 1 : 2                       // 当前学期号（1=第一学期）
  const opts = []
  // 先从当前学期递推回最旧学期（往前 TERM_YEARS_BACK 个学年，共 TERM_YEARS_BACK*2 个学期）
  let sy = curSy, t = curT
  for (let i = 0; i < TERM_YEARS_BACK * 2; i++) {
    if (t === 1) { t = 2; sy -= 1 } else { t = 1 }             // 递推上一个学期
  }
  // 从最旧学期正序生成到当前学期
  for (let i = 0; i <= TERM_YEARS_BACK * 2; i++) {
    opts.push(sy + '-' + (sy + 1) + '学年第' + (t === 1 ? '一' : '二') + '学期')
    if (t === 2) { t = 1; sy += 1 } else { t = 2 }             // 递推下一个学期
  }
  opts.push('全部')
  return opts
}

// 课程进度已接入表 3-1 字段 progress（时间口径：首节课 0% → 末节课下课 100%，无排课为 0）
//   章节数/作业数/实验数同为真实字段（chapterCount/homeworkCount/experimentCount，后端实时计数）
function mapCourse(it) {
  const firstClassTime = it.firstClassTime || null
  return {
    courseId: it.courseId,
    name: it.courseName || '未命名课程',
    teacher: it.teacherName || '',
    semester: termOf(firstClassTime),   // 展示用学期标签（按开课时间推导）
    firstClassTime,
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
  data: {
    courses: [],        // 当前筛选下展示的课程
    allCourses: [],     // 全量（筛选在此之上进行）
    termOptions: [],    // 下拉选项（索引 0 = 最新学期，末项 = '全部'）
    termIndex: 0,       // 当前选中的下拉索引（默认指向'全部'，在 onShow 里初始化）
    currentTerm: '全部',
    loading: true
  },

  // onShow 而非 onLoad：每次进入/返回本页自动刷新（教师增删章节/作业后，数字即时更新）
  onShow() {
    // 下拉选项固定按"当前时间"生成（当前学期 + 往前五年 + 全部置底），默认选中'全部'
    const termOptions = buildTermOptions()
    this.setData({ termOptions, termIndex: termOptions.length - 1, currentTerm: '全部' })
    this.loadCourses()
  },
  onPullDownRefresh() { this.loadCourses().finally(() => wx.stopPullDownRefresh()) },

  async loadCourses() {
    this.setData({ loading: true })
    try {
      const data = await api.course.listMine({ page: 1, pageSize: 50 })
      const all = ((data && data.list) || []).map(mapCourse)
      this.setData({ allCourses: all, loading: false })
      this.applyFilter()
    } catch (e) {
      // request 层已 toast（401 会跳 dev-login）
      this.setData({ loading: false })
    }
  },

  // 按当前选中学期过滤（'全部' = 不筛选）
  applyFilter() {
    const { allCourses, currentTerm } = this.data
    const list = currentTerm === '全部'
      ? allCourses
      : allCourses.filter(c => c.semester === currentTerm)
    this.setData({ courses: list })
  },

  // 下拉选择学期
  onTermChange(e) {
    const idx = Number(e.detail.value)
    const val = this.data.termOptions[idx]
    this.setData({ termIndex: idx, currentTerm: val })
    this.applyFilter()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    // 课程详情（章节作业）页，课程信息/周目录走表 3-2 真实接口，作业列表待 M-C 联调
    wx.navigateTo({ url: '/pages/course-detail/course-detail?courseId=' + id })
  },
  goAddCourse() { wx.navigateTo({ url: '/pages/course-add/course-add' }) }
})
