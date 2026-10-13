// 实验报告 —— 原型：ui-prototype/mp/app-lab.html
// 接入（真实接口）：
//   api.experiment.list   GET /api/v1/experiments（实验任务列表，带我的提交状态与查重率）
//   api.experiment.submit 表 3-17 提交实验报告 POST /api/v1/experiments/{taskId}/submissions
//   api.experiment.detail 表 3-18 报告详情（取教师批阅评语）
// 注意：列表返回 Map，字段为下划线风格（task_id / course_name / sub_status / duplicate_rate …）
const api = require('../../utils/api')

/** 时间 → 「MM-DD HH:mm」 */
function fmtShort(iso) {
  return iso ? String(iso).replace('T', ' ').slice(5, 16) : '—'
}

/** 实验任务 → 卡片视图。sub_status：null=未提交 / SUBMITTED=已提交 / GRADED=已批阅 */
function mapTask(t) {
  const sub = t.sub_status
  let statusText, badge, meta, actions = false

  if (sub == null) {
    statusText = '待提交'
    badge = 'badge-warning'
    meta = '截止 ' + fmtShort(t.deadline)
    actions = true  // 待提交：展示「上传报告 / 查看实验指导书」
  } else if (sub === 'GRADED') {
    statusText = '已批阅' + (t.sub_score != null ? ' · ' + t.sub_score : '')
    badge = 'badge-success'
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
    statusText, badge, meta, actions,
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

  onLoad() {
    this.load()
  },

  /** 实验任务列表（我选的课程），带我的提交状态 */
  async load() {
    this.setData({ loading: true })
    try {
      const list = await api.experiment.list()
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
        if (d && d.comment) {
          this.setData({ ['labs[' + i + '].comment']: '教师评语：' + d.comment })
        }
      }).catch(() => {})
    })
  },

  /** 上传报告（表 3-17）：选取文件后提交一条新版本报告（后端支持多版本提交） */
  uploadReport(e) {
    const taskId = e.currentTarget.dataset.id
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f) return
        wx.showModal({
          title: '提交实验报告',
          content: '确定提交报告文件「' + f.name + '」？提交后将进入 AI 预审与查重队列。',
          success: async (r) => {
            if (!r.confirm) return
            wx.showLoading({ title: '提交中', mask: true })
            try {
              const result = await api.experiment.submit(taskId, {
                dataFiles: JSON.stringify([{ name: f.name, size: f.size }])
              })
              wx.hideLoading()
              wx.showToast({ title: (result && result.message) || '报告已提交', icon: 'none' })
              this.load()  // 刷新提交状态
            } catch (e2) {
              // request 层已 toast（未选课 403 / 逾期且不允许迟到 422 等）
              wx.hideLoading()
            }
          }
        })
      }
    })
  },

  /** 查看实验指导书 → 资源查看页（guide 为后端返回的指导书标题） */
  viewGuide(e) {
    const guide = e.currentTarget.dataset.guide || '实验指导书'
    wx.navigateTo({
      url: '/pages/resource-view/resource-view?type=doc&title=' + encodeURIComponent(guide) + '&sub=实验指导书'
    })
  }
})
