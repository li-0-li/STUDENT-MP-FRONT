// 全部排课页 —— 展示某课程的所有排课，按上课日期排序
const api = require('../../utils/api')

/** 上课时间 → 完整「YYYY-MM-DD HH:mm」 */
function fmtFull(iso) {
  if (!iso) return ''
  return String(iso).replace('T', ' ').slice(0, 16)
}

/** 排课条目 → 卡片 */
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
    classTime: it.classTime,
    classTimeFullText: fmtFull(it.classTime),
    durationMin: it.durationMin,
    classroomName: it.classroomName,
    classroomLocation: it.classroomLocation,
    weekRef: it.weekRef,
    status: it.status,
    statusText: statusMap[it.status] || '正常'
  }
}

Page({
  data: {
    courseId: 0,
    courseName: '',
    schedules: [],
    loading: true
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0)
    if (o.courseName) {
      this.setData({ courseName: decodeURIComponent(o.courseName) })
    }
    if (!this.courseId) {
      wx.showToast({ title: '缺少课程参数', icon: 'none' })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await api.course.schedules(this.courseId)
      const list = (res || []).map(mapSchedule)
      // 按上课日期升序（最早的在前）
      list.sort((a, b) => {
        const ta = a.classTime ? new Date(a.classTime).getTime() : 0
        const tb = b.classTime ? new Date(b.classTime).getTime() : 0
        return ta - tb
      })
      this.setData({ schedules: list, loading: false })
      wx.setNavigationBarTitle({ title: '全部排课' })
    } catch (e) {
      this.setData({ loading: false })
    }
  }
})
