// 实验报告 —— 原型：ui-prototype/mp/app-lab.html
// 接入（真实接口）：
//   api.experiment.list   GET /api/v1/experiments（实验任务列表，带我的提交状态与查重率）
//   api.experiment.detail 表 3-18 报告详情（已批阅条目取教师评语）
// 提交/回显/批阅/下载统一走实验详情页（点击卡片进入）—— 在线填写走表单必填校验，
// 不再提供绕过表单的独立「上传报告」入口。
// 注意：列表返回 Map，字段为下划线风格（task_id / course_name / sub_status / duplicate_rate …）
const api = require('../../utils/api')

/** 时间 → 「MM-DD HH:mm」 */
function fmtShort(iso) {
  return iso ? String(iso).replace('T', ' ').slice(5, 16) : '—'
}

/** 实验任务 → 卡片视图。sub_status：null=未提交 / SUBMITTED=已提交 / GRADED=已批阅 / RETURNED=已退回 */
function mapTask(t) {
  // 接口实际返回小写（graded/submitted），契约文档写的是大写 —— 统一大小写不敏感比较
  const sub = t.sub_status != null ? String(t.sub_status).toUpperCase() : null
  let statusText, badge, meta

  if (sub == null) {
    statusText = '待提交'
    badge = 'badge-warning'
    meta = '截止 ' + fmtShort(t.deadline)
  } else if (sub === 'GRADED') {
    statusText = '已批阅' + (t.sub_score != null ? ' · ' + t.sub_score : '')
    badge = 'badge-success'
    meta = '提交于 ' + fmtShort(t.submit_time)
  } else if (sub === 'REVISION' || sub === 'RETURNED') {
    statusText = '已退回 · 请修改重交'
    badge = 'badge-error'
    meta = '提交于 ' + fmtShort(t.submit_time)
  } else {
    statusText = '已提交 · 待批阅'
    badge = 'badge-info'
    meta = '提交于 ' + fmtShort(t.submit_time)
  }

  // AI 查重率（相似来源明细后端暂未提供，仅展示总查重率）
  const rate = t.duplicate_rate != null ? Math.round(t.duplicate_rate) : null

  return {
    id: t.task_id,
    title: t.title || '未命名实验',
    courseName: t.course_name || '',
    statusText, badge, meta,
    subId: t.sub_id != null ? t.sub_id : null,
    guide: t.guide || '',
    plagiarism: rate != null ? { rate: rate, sources: [] } : null,
    comment: ''
  }
}

Page({
  data: {
    labs: [],
    loading: true
  },

  /** 课程详情页实验入口跳转时携带 courseId/courseName：只看该课程的实验 */
  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0) || null
    this.courseName = o.courseName ? decodeURIComponent(o.courseName) : ''
    if (this.courseName) {
      wx.setNavigationBarTitle({ title: this.courseName + ' · 实验' })
    }
    this.load()
  },

  /** 实验任务列表（我选的课程；携带 courseId 时只拉该课程），带我的提交状态 */
  async load() {
    this.setData({ loading: true })
    try {
      const list = await api.experiment.list(this.courseId)
      const labs = (list || []).map(mapTask)
      this.setData({ labs, loading: false })
      this.loadComments(labs)
    } catch (e) {
      // request 层已 toast
      this.setData({ labs: [], loading: false })
    }
  },

  /** 表 3-18：已提交的报告逐条取详情，补教师批阅评语（best-effort，失败不影响列表） */
  loadComments(labs) {
    labs.forEach((l, i) => {
      if (!l.subId) return
      api.experiment.detail(l.subId).then((d) => {
        // 评语只在已批阅状态展示（退回意见在详情页以「退回原因」单独呈现）
        if (d && d.comment && l.statusText.indexOf('已批阅') === 0) {
          this.setData({ ['labs[' + i + '].comment']: '教师评语：' + d.comment })
        }
      }).catch(() => {})
    })
  },

  /** 实验卡片 → 实验详情页（在线填写 / 回显 / 批阅 / 下载统一入口） */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/experiment-detail/experiment-detail?taskId=' + id
    })
  }
})
