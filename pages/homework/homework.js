// 我的作业 —— 原型：ui-prototype/mp/app-homework.html
// UI 设计 7.8：顶部页签切换「待提交 / 已批改 / 申诉」三类状态
// 接入：api.homework.list —— GET /api/v1/assignments（表 3-5 作业列表）
//   返回 {list:[{assignmentId,courseId,courseName,weekNum,title,assignType,totalScore,
//        startTime,deadline,status,myStatus,myScore,isLate,allowAppeal}], total,page,pageSize}
//   myStatus：null=未提交；draft/submitted/queued/grading/manual/graded/finished/appealing/returned
// 说明：后端 status 筛选仅支持单值（'pending'=未提交，其余=myStatus 值），而「已批改」页签
//   需同时覆盖 graded/finished 及批改中的 submitted 等，故一次拉全量（pageSize=100 上限）后前端分组。
const api = require('../../utils/api')

// 状态页签（UI 设计 7.8：待提交 / 已批改 / 申诉）
const STATUS_TABS = [
  { key: 'pending', label: '待提交' },
  { key: 'graded', label: '已批改' },
  { key: 'appeal', label: '申诉' }
]

const EMPTY_TEXT = {
  pending: '暂无待提交作业',
  graded: '暂无已批改作业',
  appeal: '暂无申诉中的作业'
}

/** 截止时间 → 「MM-DD HH:mm」 */
function fmtShort(iso) {
  return iso ? String(iso).replace('T', ' ').slice(5, 16) : ''
}

/** 距截止剩余时间提示（iOS 兼容：- 和 T 替换为 / 与空格） */
function remainTip(deadline) {
  if (!deadline) return { extra: '', extraWarn: false }
  const t = new Date(String(deadline).replace(/-/g, '/').replace('T', ' '))
  if (isNaN(t.getTime())) return { extra: '', extraWarn: false }
  const ms = t.getTime() - Date.now()
  if (ms <= 0) return { extra: '已截止', extraWarn: false }
  const h = Math.floor(ms / 3600000)
  const d = Math.floor(h / 24)
  const txt = d > 0 ? '剩余 ' + d + ' 天 ' + (h % 24) + ' 小时' : '剩余 ' + h + ' 小时'
  return { extra: txt, extraWarn: ms < 48 * 3600000 }
}

/** HomeworkItem → 列表卡片视图（status 为页签分组：pending / graded / appeal） */
function mapView(it) {
  const ms = it.myStatus
  const weekMeta = '第 ' + (it.weekNum || '—') + ' 周 · 总分 ' + (it.totalScore || '—')
  let status, statusText, badge, meta = weekMeta, extra = '', extraWarn = false, score = ''

  if (ms == null || ms === 'draft' || ms === 'returned') {
    // 未提交 / 草稿 / 教师退回 → 待提交组
    status = 'pending'
    statusText = ms === 'returned' ? '已退回 · 请重交' : (ms === 'draft' ? '待提交（草稿）' : '待提交')
    badge = 'badge-warning'
    meta = '截止 ' + fmtShort(it.deadline)
    const tip = remainTip(it.deadline)
    extra = tip.extra
    extraWarn = tip.extraWarn
  } else if (ms === 'appealing') {
    status = 'appeal'
    statusText = '申诉处理中'
    badge = 'badge-error'
    extra = '教师将在 2 个工作日内复核'
  } else if (ms === 'graded' || ms === 'finished') {
    status = 'graded'
    statusText = it.myScore != null ? '已批改 ' + it.myScore : '已批改'
    badge = 'badge-success'
    score = it.myScore != null ? String(it.myScore) : ''
    extra = it.isLate ? '逾期提交' : ''
  } else {
    // submitted / queued / grading / manual：已提交，等待批改（归入「已批改」页签展示进度）
    status = 'graded'
    statusText = '已提交 · 批改中'
    badge = 'badge-info'
    meta = '截止 ' + fmtShort(it.deadline)
  }

  return {
    id: it.assignmentId,
    title: it.title || '未命名作业',
    courseName: it.courseName || '',
    status, statusText, badge, meta, extra, extraWarn, score,
    allowAppeal: !!it.allowAppeal
  }
}

Page({
  data: {
    tabs: [],           // [{key,label,active}]
    current: 'pending', // 当前状态页签
    list: [],           // 筛选后的作业列表
    emptyText: '',
    loading: true
  },

  onLoad() {
    this.all = []        // 全量作业（已映射为卡片视图）
    this._firstShow = true
    this.setData({
      tabs: STATUS_TABS.map(t => ({ key: t.key, label: t.label, active: t.key === this.data.current }))
    })
    this.loadAll()
  },

  // 从作业提交页返回后刷新状态（首次 onShow 跳过，避免与 onLoad 重复请求）
  onShow() {
    if (this._firstShow) { this._firstShow = false; return }
    this.loadAll()
  },

  /** 表 3-5 作业列表：拉全量后按页签分组 */
  async loadAll() {
    this.setData({ loading: true })
    try {
      const data = await api.homework.list({ page: 1, pageSize: 100 })
      this.all = (((data && data.list) || [])).map(mapView)
    } catch (e) {
      this.all = []  // request 层已 toast
    }
    this.setData({ loading: false })
    this.applyFilter(this.data.current, true)
  },

  /** 状态页签切换（待提交 / 已批改 / 申诉） */
  switchTab(e) {
    this.applyFilter(e.currentTarget.dataset.key)
  },

  applyFilter(key, force) {
    if (!key) key = 'pending'
    if (key === this.data.current && !force && this.data.tabs.length) return
    this.setData({
      current: key,
      tabs: STATUS_TABS.map(t => ({ key: t.key, label: t.label, active: t.key === key })),
      list: this.all.filter(h => h.status === key),
      emptyText: EMPTY_TEXT[key] || '暂无作业'
    })
  },

  /** 点击条目 → 作业提交页（已批改可查看详情） */
  goSubmission(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/submission/submission?id=' + id
    })
  }
})
