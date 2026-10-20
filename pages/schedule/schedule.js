// 我的课表 —— 原型：ui-prototype/mp/app-schedule.html（UI 设计文档 7.6）
// 接入：api.schedule.mine —— GET /api/v1/schedules（表 3-12，后端按学生选课自动过滤）
//   返回 [{scheduleId,courseName,teacherName,classroomName,classTime,weekday(1周一~7周日),
//          periodNo,periodName,startTime,endTime,weekRef,status}]，一次拉全量后按周在前端过滤
//   周次说明：后端无「学期起始周」接口，周徽标优先取当周课程的 weekRef，无课的周按本周 weekRef + 偏移推算
const api = require('../../utils/api')

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 课程色带（与原型 COLORS 一致；未登记的课程按首次出现顺序循环取兜底色）
const COURSE_COLORS = {
  '高等数学 A': '#a7f3d0',
  '数据结构': '#bfdbfe',
  '大学英语 III': '#fde68a',
  '程序设计基础': '#ddd6fe'
}
const COLOR_FALLBACK = ['#a7f3d0', '#bfdbfe', '#fde68a', '#ddd6fe']

function fmtDate(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
}

// 完整时间 → 「HH:mm」
function fmtTime(iso) {
  if (!iso) return ''
  return String(iso).replace('T', ' ').slice(11, 16)
}

Page({
  data: {
    days: [],        // 周一~周日 tab（含日期）
    current: 0,      // 当前选中星期下标
    today: 0,        // 今天星期下标
    dayTitle: '',    // 「周一 · 9月28日」
    weekOffset: 0,   // 周次偏移：0=本周，-1=上周，1=下周
    weekBadge: '',   // 「第 N 周」（取自课程 weekRef）
    isThisWeek: true,
    list: [],        // 当天课程
    loading: true
  },

  onLoad() {
    const now = new Date()
    const today = (now.getDay() + 6) % 7 // 周一=0
    this.all = []          // 全量排课（date/weekday 为过滤键）
    this.weekBase = 0      // 本周 weekRef（该周无课时用于推算相邻周）
    this.courseColors = {} // 未登记课程的自动配色
    this.colorSeq = 0
    this.setData({ today, current: today })
    this.renderDays()
    this.loadSchedules()
  },

  onPullDownRefresh() {
    this.loadSchedules().finally(() => wx.stopPullDownRefresh())
  },

  async loadSchedules() {
    this.setData({ loading: true })
    try {
      const res = await api.schedule.mine()
      const list = (res && res.list) || []
      this.all = list.map((it) => {
        const dateStr = (it.classTime || '').slice(0, 10)              // yyyy-mm-dd
        // 优先用上课日期反推星期（0=周一），保证与顶部自然周一致；weekday 字段仅兜底
        let weekday = (it.weekday || 1) - 1
        if (dateStr) {
          const dt = new Date(dateStr.replace(/-/g, '/'))
          const wd = (dt.getDay() + 6) % 7
          if (!isNaN(wd)) weekday = wd
        }
        return {
          date: dateStr,
          weekday: weekday,
          s: it.periodName || ((it.periodNo || '') + '节'),
          t: fmtTime(it.startTime) + '-' + fmtTime(it.endTime),
          c: it.courseName || '未命名课程',
          loc: it.classroomName || '教室待定',
          tc: it.teacherName || '',
          weekRef: it.weekRef || 0,
          ongoing: it.status === 'ongoing'
        }
      })
      // 相对周次（开学当周=1，可能为 0/负数/大于20）；无学期信息时为 null
      this.weekBase = (res && res.currentWeek != null) ? res.currentWeek : null
      this.setData({ loading: false })
      this.renderDays()
      this.renderList()
    } catch (e) {
      // request 层已 toast（401 会跳登录），此处保留空表
      this.all = []
      this.setData({ loading: false })
      this.renderList()
    }
  },

  // 指定偏移周的周一/周日（含日期字符串，供排课过滤）
  weekRange(offset) {
    const now = new Date()
    const today = (now.getDay() + 6) % 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - today + offset * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { monday: monday, monStr: fmtDate(monday), sunStr: fmtDate(sunday) }
  },

  // 落在指定偏移周内的排课（按 classTime 日期过滤，与 weekday 冗余字段一致）
  itemsInWeek(offset) {
    const r = this.weekRange(offset)
    return this.all.filter(function (it) {
      return it.date && it.date >= r.monStr && it.date <= r.sunStr
    })
  },

  // 周徽标：教学周固定为 第1周~第20周（第1周从开学日期所在自然周起）
  // 落在范围内显示「第 N 周」，开学前或第20周之后显示「-」
  weekBadgeFor(offset) {
    if (this.weekBase !== null && this.weekBase !== undefined) {
      const w = this.weekBase + offset
      if (w >= 1 && w <= 20) return '第 ' + w + ' 周'
      return '-'
    }
    return '-'
  },

  // 周一~周日 + 日期（按 weekOffset 平移一周）
  renderDays() {
    const monday = this.weekRange(this.data.weekOffset).monday
    const days = DAYS.map(function (name, i) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return { name: name, date: (d.getMonth() + 1) + '/' + d.getDate() }
    })
    this.setData({
      days: days,
      weekBadge: this.weekBadgeFor(this.data.weekOffset),
      isThisWeek: this.data.weekOffset === 0
    })
  },

  // 切换星期 tab
  selectDay(e) {
    this.setData({ current: e.currentTarget.dataset.i })
    this.renderList()
  },

  // 周次切换：prev / next / back（返回本周）
  shiftWeek(e) {
    const act = e.currentTarget.dataset.act
    let off = this.data.weekOffset
    if (act === 'prev') off -= 1
    else if (act === 'next') off += 1
    else off = 0
    if (off === this.data.weekOffset) return
    this.setData({ weekOffset: off })
    this.renderDays()
    this.renderList()
  },

  renderList() {
    const { current, today, days, isThisWeek } = this.data
    const list = this.itemsInWeek(this.data.weekOffset)
      .filter((it) => it.weekday === current)
      .map((it) => Object.assign({}, it, { color: this.colorOf(it.c) }))
    const day = days[current]
    const dayTitle = day ? day.name + ' · ' + day.date + (isThisWeek && current === today ? '（今天）' : '') : ''
    this.setData({ list: list, dayTitle: dayTitle })
  },

  // 课程配色：登记过的课程固定色，未登记的按出现顺序循环兜底色（跨天保持一致）
  colorOf(name) {
    if (COURSE_COLORS[name]) return COURSE_COLORS[name]
    if (!this.courseColors[name]) {
      this.courseColors[name] = COLOR_FALLBACK[this.colorSeq++ % COLOR_FALLBACK.length]
    }
    return this.courseColors[name]
  },

  // 进入课堂（进行中课程）。课堂会话 id 后端暂无发现接口，live 页使用默认演示课堂
  goLive() { wx.navigateTo({ url: '/pages/live/live' }) }
})
