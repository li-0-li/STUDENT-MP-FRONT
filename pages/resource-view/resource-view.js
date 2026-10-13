// 资源查看 —— 原型：ui-prototype/mp/resource-view.html
// 接入（全部真实接口）：
//   表 3-2 api.course.detail       课程详情（课程名 + 教学周目录）
//   表 3-4 api.course.listResources 资源列表（weekNum 筛选）
// 查看器按 fileType 渲染：video→video 组件 / image→image 组件 / doc·table→下载后 openDocument /
//   quiz→题库内容由 M-C 模块提供，此处仅列表登记。
const api = require('../../utils/api')
const { FILE_BASE_URL } = require('../../utils/config')

const TYPE_META = {
  doc: { icon: '📄', label: '文档' },
  video: { icon: '🎬', label: '视频' },
  image: { icon: '🖼', label: '图片' },
  table: { icon: '📊', label: '表格' },
  quiz: { icon: '📝', label: '题库' }
}
// openDocument 支持的扩展名
const OPENABLE = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}
function fmtDuration(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60), s = sec % 60
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}

Page({
  data: {
    fileBase: FILE_BASE_URL, // 供 wxml 拼接资源直链
    courseName: '',
    weeks: [],            // 表 3-2 周目录 [{weekNum,title,status}]
    weekChips: [],        // [{num,label,active}]  首位为「全部」
    currentWeek: 0,       // 0 = 全部
    resources: [],        // 表 3-4 列表（已映射展示字段）
    current: null,        // 当前选中资源
    quizResourceId: 0,    // 已加载题库的资源 id
    quizQuestions: [],    // 题库预览 [{idx,stem,options:[{key,text}]}]
    textResourceId: 0,    // 已加载文本的资源 id
    textContent: '',      // txt 预览内容
    loading: true
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0)
    // 已下载文件的本地路径表 {resourceId: savedFilePath}，跨会话持久
    this.savedFiles = wx.getStorageSync('stuSavedFiles') || {}
    if (!this.courseId) {
      wx.showToast({ title: '缺少课程参数', icon: 'none' })
      return
    }
    this.load()
  },

  /** 表 3-2 详情（课程名 + 周目录）→ 默认「全部」拉资源（表 3-4） */
  async load() {
    this.setData({ loading: true })
    try {
      const detail = await api.course.detail(this.courseId)
      const weeks = detail.weeks || []
      this.setData({
        courseName: (detail.course && detail.course.courseName) || '',
        weeks,
        weekChips: this.buildChips(weeks, 0),
        loading: false
      })
      wx.setNavigationBarTitle({ title: (detail.course && detail.course.courseName) || '资源查看' })
      await this.loadResources()
    } catch (e) {
      // request 层已 toast（未选课 403 / 401 跳 dev-login）
      this.setData({ loading: false })
    }
  },

  buildChips(weeks, current) {
    const chips = [{ num: 0, label: '全部', active: current === 0 }]
    weeks.forEach(w => {
      chips.push({ num: w.weekNum, label: '第' + w.weekNum + '周', active: current === w.weekNum })
    })
    // 无周目录时补 1-16（课程尚未维护周，资源仍可挂周次）
    if (!weeks.length) {
      for (let i = 1; i <= 16; i++) chips.push({ num: i, label: '第' + i + '周', active: current === i })
    }
    return chips
  },

  switchWeek(e) {
    const num = Number(e.currentTarget.dataset.week)
    if (num === this.data.currentWeek) return
    this.setData({ currentWeek: num, weekChips: this.buildChips(this.data.weeks, num) })
    this.loadResources()
  },

  /** 表 3-4：按周拉资源并映射展示字段 */
  async loadResources() {
    try {
      const params = { page: 1, pageSize: 100 }
      if (this.data.currentWeek) params.weekNum = this.data.currentWeek
      const data = await api.course.listResources(this.courseId, params)
      const list = ((data && data.list) || []).map(it => {
        const ft = String(it.fileType || 'doc').toLowerCase()
        const meta = TYPE_META[ft] || TYPE_META.doc
        const bits = []
        if (it.pageCount) bits.push(it.pageCount + ' 页')
        if (it.durationSec) bits.push(fmtDuration(it.durationSec))
        if (it.fileSize) bits.push(fmtSize(it.fileSize))
        return {
          resourceId: it.resourceId,
          fileName: it.fileName || '未命名资源',
          fileUrl: it.fileUrl || '',
          fileType: ft,
          icon: meta.icon,
          typeLabel: meta.label,
          indexStatus: it.indexStatus || 'pending',
          indexText: it.indexStatus === 'success' ? '已索引' : '待索引',
          indexBadge: it.indexStatus === 'success' ? 'badge-success' : 'badge-warning',
          meta: bits.join(' · '),
          savedPath: this.savedFiles[it.resourceId] || ''
        }
      })
      this.setData({ resources: list, current: list[0] || null })
    } catch (e) {
      this.setData({ resources: [], current: null })
    }
  },

  onResourceTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    const r = this.data.resources.find(x => x.resourceId === id)
    if (r) this.setData({ current: r })
  },

  /** 图片全屏预览 */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url] })
  },

  /** 打开/预览当前资源：video/image 组件直渲染（已下载则用本地文件）；doc/table 打开文档；quiz 拉取题库内容展示 */
  openCurrent() {
    const r = this.data.current
    if (!r) return
    if (r.fileType === 'quiz') {
      this.loadQuiz(r)
      return
    }
    if (r.fileType === 'video' || r.fileType === 'image') {
      // wxml 里 video/image 组件渲染 savedPath（已下载）或直链，无需处理
      return
    }
    // openDocument 不支持 txt：无论是否已下载，都拉文本在卡片内展示
    const ext = this.extOf(r)
    if (ext === 'txt' || r.fileUrl.split('?')[0].endsWith('.txt')) {
      this.loadText(r)
      return
    }
    // doc/table：已下载直接开本地文件
    if (r.savedPath) {
      this.openDocument(r.savedPath)
      return
    }
    // 未下载：临时下载后预览（不落盘）
    if (!r.fileUrl) {
      wx.showToast({ title: '该资源暂无可打开文件', icon: 'none' })
      return
    }
    if (!OPENABLE.includes(ext)) {
      wx.showToast({ title: '该格式暂不支持在线预览，可先下载到本地', icon: 'none' })
      return
    }
    wx.showLoading({ title: '加载中…', mask: true })
    wx.downloadFile({
      url: FILE_BASE_URL + r.fileUrl,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode !== 200) {
          wx.showToast({ title: '加载失败（' + res.statusCode + '）', icon: 'none' })
          return
        }
        this.openDocument(res.tempFilePath)
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '加载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /** 文本预览：拉取 txt 内容在卡片内展示（openDocument 不支持 txt） */
  loadText(r) {
    if (this.data.textResourceId === r.resourceId) return
    wx.showLoading({ title: '加载中…', mask: true })
    wx.request({
      url: FILE_BASE_URL + r.fileUrl,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode !== 200 || typeof res.data !== 'string') {
          wx.showToast({ title: '文本加载失败（' + res.statusCode + '）', icon: 'none' })
          return
        }
        this.setData({ textResourceId: r.resourceId, textContent: res.data || '（空文件）' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '文本加载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /** 下载按钮：已下载 → 打开本地文件；未下载 → 真正下载保存到本地 */
  onDownloadTap() {
    const r = this.data.current
    if (!r) return
    if (r.savedPath) {
      this.openSaved(r)
      return
    }
    this.downloadToDisk()
  },

  /** 题库预览：拉取题库 JSON（约定：fileUrl 指向 .pdf 供下载，同名 .json 为预览数据源），逐题展示（作答归 M-C 模块） */
  loadQuiz(r) {
    if (!r.fileUrl) {
      wx.showToast({ title: '该题库暂无内容文件', icon: 'none' })
      return
    }
    if (this.data.quizResourceId === r.resourceId && this.data.quizQuestions.length) return
    wx.showLoading({ title: '加载题库…', mask: true })
    wx.request({
      url: FILE_BASE_URL + r.fileUrl.replace(/\.pdf(\?.*)?$/i, '.json'),
      success: (res) => {
        wx.hideLoading()
        const body = res.data
        const questions = (body && Array.isArray(body.questions) ? body.questions : Array.isArray(body) ? body : [])
        if (!questions.length) {
          wx.showToast({ title: '题库内容为空或格式不支持', icon: 'none' })
          return
        }
        this.setData({
          quizResourceId: r.resourceId,
          quizQuestions: questions.map((q, i) => ({
            idx: i + 1,
            stem: q.stem || q.title || q.question || '',
            options: (q.options || []).map((o, j) => ({ key: j, text: o }))
          }))
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '题库加载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /** 真正下载：downloadFile → saveFile 持久保存到小程序本地文件区 */
  downloadToDisk() {
    const r = this.data.current
    if (!r || !r.fileUrl) {
      wx.showToast({ title: '该资源暂无可下载文件', icon: 'none' })
      return
    }
    wx.showLoading({ title: '下载中…', mask: true })
    wx.downloadFile({
      url: FILE_BASE_URL + r.fileUrl,
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.hideLoading()
          wx.showToast({ title: '下载失败（' + res.statusCode + '）', icon: 'none' })
          return
        }
        wx.saveFile({
          tempFilePath: res.tempFilePath,
          success: (save) => {
            wx.hideLoading()
            this.markSaved(r.resourceId, save.savedFilePath)
            wx.showToast({ title: '已下载到本地', icon: 'success' })
          },
          fail: () => {
            wx.hideLoading()
            // 本地空间不足等场景：退化为仅预览
            wx.showToast({ title: '保存失败（本地空间不足？）', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /** 打开已保存的本地文件（按类型分派） */
  openSaved(r) {
    if (r.fileType === 'video' || r.fileType === 'image') {
      // video/image 的 src 已切到本地路径（wxml 绑定 savedPath），此处仅提示
      wx.showToast({ title: '已切换为本地文件（离线可用）', icon: 'none' })
      return
    }
    // 微信 openDocument 打不开 txt，提示回卡片查看（内容已在线展示）
    if (this.extOf(r) === 'txt') {
      wx.showToast({ title: '文本文件请点上方卡片在线查看', icon: 'none' })
      return
    }
    // doc/table/quiz（题库下载的是 pdf）统一 openDocument
    this.openDocument(r.savedPath)
  },

  /** openDocument 打开文档（fileType 取 fileUrl 扩展名） */
  openDocument(filePath) {
    const r = this.data.current
    const ext = this.extOf(r)
    wx.openDocument({
      filePath,
      fileType: ext,
      showMenu: true,
      fail: () => wx.showToast({ title: '打开失败，可尝试重新下载', icon: 'none' })
    })
  },

  /** 扩展名：优先 fileUrl（库里 fileName 常无扩展名/带中文点号），fileName 兜底 */
  extOf(r) {
    const fromUrl = (r.fileUrl.split('?')[0].split('.').pop() || '').toLowerCase()
    if (OPENABLE.includes(fromUrl)) return fromUrl
    const fromName = (r.fileName.split('.').pop() || '').toLowerCase()
    return OPENABLE.includes(fromName) ? fromName : fromUrl
  },

  /** 记录已下载状态（页面内存 + 本地存储 + 列表/当前资源同步刷新） */
  markSaved(resourceId, savedFilePath) {
    this.savedFiles[resourceId] = savedFilePath
    wx.setStorageSync('stuSavedFiles', this.savedFiles)
    const resources = this.data.resources.map(it =>
      it.resourceId === resourceId ? { ...it, savedPath: savedFilePath } : it)
    const current = this.data.current && this.data.current.resourceId === resourceId
      ? { ...this.data.current, savedPath: savedFilePath } : this.data.current
    this.setData({ resources, current })
  }
})
