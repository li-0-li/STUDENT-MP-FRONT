// 实验详情 —— 原型：ui-prototype/mp/app-lab.html（详情分区展示）
// 接入（真实接口）：
//   api.experiment.taskDetail  GET /api/v1/experiments/{taskId}（缺口补位：目的/内容要求/材料/评分标准/报告模板）
//   api.experiment.detail      表 3-18 报告详情（回显我的报告内容 + 教师评语/批注/等级，best-effort）
//   api.experiment.submit      表 3-17 提交实验报告（在线填写 formData + 可选附件名）
//   api.experiment.report      表 3-22 报告 PDF 下载（有文件给地址，无文件给提示）
// 注意：详情返回 Map，字段为下划线风格（objective / score_rubric / sub_status …），
//       JSON 字段（materials/score_rubric/report_template/annotations）为原始字符串，这里解析并兜底。
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { FILE_BASE_URL } = require('../../utils/config')

/** 时间 → 「YYYY-MM-DD HH:mm」 */
function fmtFull(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 16) : '—'
}

/** 原始 JSON 字符串 → 解析对象（容错：非 JSON / 空返回 null） */
function parseJson(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

/** 原始 JSON 字符串 → 数组（容错：串/对象/数组均可，解析失败返回空数组） */
function parseList(raw) {
  const v = parseJson(raw)
  if (v == null) return []
  if (Array.isArray(v)) return v
  if (Array.isArray(v.items)) return v.items
  if (Array.isArray(v.sections)) return v.sections
  return []
}

/**
 * 我的 form_data → {小节标题: 内容} 映射。
 * 历史数据两种形态都存在：
 *   ① {"sections":[{section, content}]}（结构化，9014 形态）
 *   ② {小节标题: 内容}（扁平 map，M-C buildReportContent 的取值口径）
 */
function parseFormData(raw) {
  const v = parseJson(raw)
  if (v == null) return {}
  if (v.sections && Array.isArray(v.sections)) {
    const map = {}
    v.sections.forEach((s) => {
      if (s && s.section != null) map[s.section] = s.content != null ? s.content : ''
    })
    return map
  }
  // 扁平 map（剔除可能是元数据的 key 由调用方按模板取值，这里原样返回）
  return v
}

/** 详情 Map → 视图模型（字段为接口下划线风格） */
function mapDetail(t) {
  // 状态口径与实验页一致；接口实际返回小写，统一大小写不敏感比较
  const sub = t.sub_status != null ? String(t.sub_status).toUpperCase() : null
  let statusText, badge, meta, canSubmit = false
  if (sub === 'GRADED') {
    statusText = '已批阅' + (t.sub_score != null ? ' · ' + t.sub_score : '')
    badge = 'badge-success'
    meta = '提交于 ' + fmtFull(t.submit_time)
  } else if (sub === 'REVISION' || sub === 'RETURNED') {
    // 教师退回：允许修改后重交（表单重新可编辑并回显上次内容）
    statusText = '已退回 · 请修改重交'
    badge = 'badge-error'
    meta = '提交于 ' + fmtFull(t.submit_time)
    canSubmit = true
  } else if (sub == null) {
    statusText = '待提交'
    badge = 'badge-warning'
    meta = '截止 ' + fmtFull(t.deadline)
    canSubmit = true  // 待提交：在线填写报告表单
  } else {
    statusText = '已提交 · 待批阅'
    badge = 'badge-info'
    meta = '提交于 ' + fmtFull(t.submit_time)
  }

  // 评分标准：{"items":[{item,maxScore,keyPoints}]}
  const rubricItems = parseList(t.score_rubric).map((it) => ({
    name: (it && (it.item || it.name)) || '',
    score: it && (it.maxScore != null ? it.maxScore : it.score),
    points: (it && (it.keyPoints || it.desc)) || ''
  }))
  // 报告模板：{"sections":[{section,required}]} → 在线填写表单的小节骨架
  const tplSections = parseList(t.report_template).map((s) => ({
    title: typeof s === 'string' ? s : ((s && (s.section || s.title)) || ''),
    required: !!(s && typeof s === 'object' && s.required)
  }))
  // 实验材料：数组（字符串或对象，发布时可为空）
  const materials = parseList(t.materials).map((m) =>
    typeof m === 'string' ? m : ((m && (m.name || m.title || m.url)) || '')
  ).filter(Boolean)

  return {
    taskId: t.task_id,
    title: t.title || '未命名实验',
    courseName: t.course_name || '',
    weekText: t.week_num ? '第 ' + t.week_num + ' 周' : '',
    totalScore: t.total_score,
    statusText, badge, meta, canSubmit,
    subState: sub || '',  // graded / submitted / returned / ''
    subId: t.sub_id != null ? t.sub_id : null,
    versionNo: t.version_no,
    duplicateRate: t.duplicate_rate != null ? Math.round(t.duplicate_rate) : null,
    objective: t.objective || '',
    principle: t.principle || '',
    guide: t.guide || '',
    materials,
    rubricItems,
    tplSections,
    startTime: fmtFull(t.start_time),
    deadline: fmtFull(t.deadline),
    lateText: t.allow_late
      ? ('允许逾期提交' + (t.late_deduct_per_day > 0 ? ' · 每逾期 1 天扣 ' + t.late_deduct_per_day + ' 分' : ''))
      : '不允许逾期提交',
    plagiarismText: t.plagiarism_check ? '开启（提交后进入 AI 查重队列）' : '关闭',
    // 我的报告内容（表 3-18 回显，待提交时为空）
    myReportSections: [],
    myDataFiles: [],
    comment: '',
    grade: '',
    annotations: []
  }
}

/** openDocument 支持的扩展名（与资源查看页同一口径） */
const OPENABLE = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']

Page({
  data: {
    taskId: 0,
    lab: null,
    loading: true,
    // 在线填写表单草稿：{sectionTitle: content}
    draft: {}
  },

  onLoad(options) {
    const o = options || {}
    this.taskId = Number(o.taskId || 0)
    if (!this.taskId) {
      wx.showToast({ title: '缺少实验参数', icon: 'none' })
      return
    }
    this.load()
  },

  /** 实验任务详情（缺口补位接口）；已提交的顺带回显报告内容与教师批阅 */
  async load() {
    this.setData({ loading: true })
    try {
      const t = await api.experiment.taskDetail(this.taskId)
      const lab = mapDetail(t || {})
      this.setData({ lab, draft: {}, loading: false })
      wx.setNavigationBarTitle({ title: lab.title })
      if (lab.subId) {
        this.loadMySubmission(lab)
      }
    } catch (e) {
      // request 层已 toast（未选课 403 / 不存在 404）
      this.setData({ lab: null, loading: false })
    }
  },

  /** 表 3-18：回显我的报告内容 + 教师评语/批注/等级（best-effort，失败不影响详情展示） */
  loadMySubmission(lab) {
    api.experiment.detail(lab.subId).then((d) => {
      if (!d) return
      // 回显：按模板小节顺序取 form_data 内容
      const formData = parseFormData(d.form_data)
      const myReportSections = (lab.tplSections || []).map((s) => ({
        title: s.title,
        required: s.required,
        content: formData[s.title] != null ? String(formData[s.title]) : ''
      }))
      // 附件（/files/ 开头的是真实上传文件，可点开预览；历史数据为纯文件名）
      const myDataFiles = parseList(d.data_files).map((f) => {
        const url = typeof f === 'string' ? f : (f && f.url) || ''
        const name = url.includes('/') ? url.substring(url.lastIndexOf('/') + 1) : (url || '附件')
        return { name, url: url.indexOf('/files/') === 0 ? url : '' }
      })
      const annotations = parseList(d.annotations).map((a) =>
        typeof a === 'string' ? a : ((a && (a.comment || a.note || a.text)) || JSON.stringify(a))
      ).filter(Boolean)
      this.setData({ 'lab.myReportSections': myReportSections })
      this.setData({ 'lab.myDataFiles': myDataFiles })
      this.setData({ 'lab.annotations': annotations })
      this.setData({ 'lab.comment': d.comment || '' })
      this.setData({ 'lab.grade': d.grade || '' })
      // 教师退回：表单重新可编辑，草稿预填上次内容（改哪里一目了然）
      if (lab.subState === 'RETURNED') {
        const draft = {}
        myReportSections.forEach((s) => { draft[s.title] = s.content })
        this.setData({ draft })
      }
    }).catch(() => {})
  },

  /** 在线填写：textarea 输入 → 草稿 */
  onSectionInput(e) {
    const title = e.currentTarget.dataset.title
    this.setData({ ['draft.' + title]: e.detail.value })
  },

  /** 必填校验：缺必填小节时 toast 并返回 true（表单提交与附件提交共用，后端有同款兜底） */
  hasMissingRequired(sections) {
    const missing = sections.filter((s) => s.required && !(s.content || '').trim())
    if (missing.length) {
      wx.showToast({ title: '「' + missing[0].title + '」为必填项', icon: 'none' })
      return true
    }
    return false
  },

  /** 收集表单草稿 → 小节数组 */
  collectSections() {
    return (this.data.lab.tplSections || []).map((s) => ({
      section: s.title,
      required: s.required,
      content: this.data.draft[s.title] != null ? this.data.draft[s.title] : ''
    }))
  },

  /** 在线提交报告（表 3-17）：按模板小节收集草稿，必填校验后走 formData */
  submitReport() {
    const sections = this.collectSections()
    if (this.hasMissingRequired(sections)) return
    wx.showModal({
      title: '提交实验报告',
      content: '确定提交？提交后进入 AI 预审与查重队列，教师批阅前不允许修改。',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        try {
          // formData 与库内 9014 同形态：{"sections":[{section,required,content}]}
          const result = await api.experiment.submit(this.taskId, {
            formData: { sections }
          })
          wx.hideLoading()
          wx.showToast({ title: (result && result.message) || '报告已提交', icon: 'none' })
          this.load()  // 刷新提交状态并回显
        } catch (e2) {
          // request 层已 toast（未选课 403 / 逾期 409 / 重复提交 409 / 必填缺失 400 等）
          wx.hideLoading()
        }
      }
    })
  },

  /**
   * 上传报告附件（表 3-17 + 通用上传 POST /api/v1/files/upload）：
   * 文件真实上传落盘后，以返回的 /files/… 地址提交附件。
   */
  uploadAttachment() {
    const sections = this.collectSections()
    if (this.hasMissingRequired(sections)) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f) return
        wx.showModal({
          title: '提交实验报告附件',
          content: '确定提交附件「' + f.name + '」？附件与已填写内容一并提交。',
          success: async (r) => {
            if (!r.confirm) return
            wx.showLoading({ title: '上传中', mask: true })
            try {
              const url = await this.uploadFile(f)
              const result = await api.experiment.submit(this.taskId, {
                formData: { sections },
                dataFiles: [url]
              })
              wx.hideLoading()
              wx.showToast({ title: (result && result.message) || '报告已提交', icon: 'none' })
              this.load()
            } catch (e2) {
              wx.hideLoading()
              if (!e2 || !e2.handled) {
                wx.showToast({ title: '附件上传失败，请重试', icon: 'none' })
              }
            }
          }
        })
      }
    })
  },

  /** wx.uploadFile → POST /api/v1/files/upload，成功返回文件 URL */
  uploadFile(f) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: FILE_BASE_URL + '/api/v1/files/upload',
        filePath: f.path,
        name: 'file',
        header: { Authorization: 'Bearer ' + auth.getToken() },
        success: (res) => {
          try {
            const body = JSON.parse(res.data)
            if (body && (body.code === 0 || body.code === 200) && body.data && body.data.url) {
              resolve(body.data.url)
            } else {
              reject(new Error('上传失败'))
            }
          } catch (e) {
            reject(e)
          }
        },
        fail: reject
      })
    })
  },

  /** 附件预览：/files/ 真实文件下载后按扩展名打开 */
  openAttachment(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const ext = url.split('?')[0].split('.').pop().toLowerCase()
    if (!OPENABLE.includes(ext)) {
      wx.showToast({ title: '该格式暂不支持在线预览', icon: 'none' })
      return
    }
    wx.showLoading({ title: '加载中…', mask: true })
    wx.downloadFile({
      url: FILE_BASE_URL + url,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode !== 200) {
          wx.showToast({ title: '加载失败（' + res.statusCode + '）', icon: 'none' })
          return
        }
        wx.openDocument({ filePath: res.tempFilePath, fileType: ext, fail: () => {} })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '加载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /** 导出实验报告（表 3-22，Word 格式）：后端给地址则下载预览，无文件展示提示 */
  downloadReport() {
    if (!this.data.lab || !this.data.lab.subId) return
    api.experiment.report(this.data.lab.subId).then((r) => {
      if (!r || !r.url) {
        wx.showToast({ title: (r && r.message) || '报告导出失败，请稍后重试', icon: 'none' })
        return
      }
      const ext = r.url.split('?')[0].split('.').pop().toLowerCase()
      wx.showLoading({ title: '导出中…', mask: true })
      wx.downloadFile({
        url: FILE_BASE_URL + r.url,
        success: (res) => {
          wx.hideLoading()
          if (res.statusCode !== 200) {
            wx.showToast({ title: '导出失败（' + res.statusCode + '）', icon: 'none' })
            return
          }
          wx.openDocument({
            filePath: res.tempFilePath,
            fileType: ext,
            fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '导出失败，请检查网络', icon: 'none' })
        }
      })
    }).catch(() => {})
  }
})
