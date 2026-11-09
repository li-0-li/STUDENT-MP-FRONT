// 选联系人页（期2 建群/私聊）—— mode=group 多选建群 / mode=direct 单选私聊
// 流程：先选课程（我学的课）→ 该课程花名册（姓名/学号搜索）→ 选人提交
//   群聊：多选 + 输入群名 → POST /conversations {convType:'group', title, courseId, memberIds}
//   私聊：单选确认 → POST /conversations {convType:'direct', targetUserId}
// 建成后 navigateBack 回 messages 页并打开聊天浮层
const api = require('../../utils/api')

Page({
  data: {
    mode: 'group',        // group=建群（多选） / direct=私聊（单选）
    courses: [],           // [{courseId, courseName}]
    courseId: null,
    courseName: '',
    keyword: '',           // 姓名/学号搜索（本地过滤，列表一次拉全）
    roster: [],            // 全量花名册 [{studentId, name, studentNo}]
    filtered: [],           // 搜索过滤后的展示列表（附加 checked 标记）
    selected: {},          // group 模式已选 {studentId: true}
    selectedCount: 0,
    loading: true,
    meId: null             // 排除自己（私聊不能和自己）
  },

  onLoad(options) {
    this.setData({ mode: options.mode === 'direct' ? 'direct' : 'group' })
    wx.setNavigationBarTitle({ title: this.data.mode === 'group' ? '发起群聊' : '发起私聊', fail: function () {} })
    this.loadMe()
  },

  async loadMe() {
    try {
      const u = await api.user.me()
      this.setData({ meId: u && u.userId })
    } catch (e) { /* request 层已 toast */ }
    this.loadCourses()
  },

  // 我学的课 → 课程选择条
  async loadCourses() {
    try {
      const res = await api.course.listMine({ page: 1, pageSize: 100 })
      const courses = (res && res.list) || []
      this.setData({ courses, loading: false })
      if (courses.length) this.selectCourse({ currentTarget: { dataset: { id: courses[0].courseId, name: courses[0].courseName } } })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  // 切课程 → 拉该课程花名册（pageSize=100 拉全，搜索走本地过滤，弱网下输入零延迟）
  async selectCourse(e) {
    const id = Number(e.currentTarget.dataset.id)
    const name = e.currentTarget.dataset.name
    this.setData({ courseId: id, courseName: name, keyword: '', selected: {}, selectedCount: 0, loading: true })
    try {
      const res = await api.message.roster(id, { page: 1, pageSize: 100 })
      const meId = this.data.meId
      const roster = ((res && res.list) || [])
        .filter(function (s) { return s.studentId !== meId })   // 不和自己建群/私聊
        .map(function (s) {
          const name = s.name || ('同学 ' + s.studentId)
          return { studentId: s.studentId, name: name, initial: name.slice(0, 1), studentNo: s.studentNo || '' }
        })
      this.setData({ roster, loading: false })
      this.applyFilter()
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  // 搜索输入（姓名/学号，本地实时过滤）
  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  applyFilter() {
    const kw = (this.data.keyword || '').trim().toLowerCase()
    const sel = this.data.selected
    const list = this.data.roster.filter(function (s) {
      if (!kw) return true
      return (s.name || '').toLowerCase().indexOf(kw) >= 0 || (s.studentNo || '').toLowerCase().indexOf(kw) >= 0
    }).map(function (s) {
      return Object.assign({}, s, { checked: !!sel[s.studentId] })
    })
    this.setData({ filtered: list })
  },

  // 选人：group 翻转多选；direct 弹确认后直接建私聊
  tapStudent(e) {
    const id = Number(e.currentTarget.dataset.id)
    const s = this.data.roster.find(function (x) { return x.studentId === id })
    if (!s) return
    if (this.data.mode === 'direct') {
      const that = this
      wx.showModal({
        title: '发起私聊',
        content: '和「' + s.name + '」发起一对一会话？',
        success(res) {
          if (res.confirm) that.createDirect(s)
        }
      })
      return
    }
    const selected = Object.assign({}, this.data.selected)
    if (selected[id]) delete selected[id]
    else selected[id] = true
    this.setData({ selected, selectedCount: Object.keys(selected).length })
    this.applyFilter()
  },

  // 建私聊（后端幂等：已有会话则复用）→ 回 messages 页打开聊天
  async createDirect(s) {
    try {
      const conv = await api.message.create({ convType: 'direct', targetUserId: s.studentId })
      this.backAndOpen(conv && conv.conversationId, (conv && (conv.title || conv.peerName)) || s.name)
    } catch (e) { /* request 层已 toast */ }
  },

  // 建群：弹窗输入群名 → 提交
  async createGroup() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择群成员', icon: 'none' })
      return
    }
    const that = this
    wx.showModal({
      title: '创建群聊（已选 ' + this.data.selectedCount + ' 人）',
      editable: true,
      placeholderText: '输入群名称（必填）',
      success(res) {
        if (!res.confirm) return
        const title = (res.content || '').trim()
        if (!title) {
          wx.showToast({ title: '群名称不能为空', icon: 'none' })
          return
        }
        that.doCreateGroup(title)
      }
    })
  },

  async doCreateGroup(title) {
    const memberIds = Object.keys(this.data.selected).map(Number)
    try {
      const conv = await api.message.create({
        convType: 'group', title: title, courseId: this.data.courseId, memberIds: memberIds
      })
      wx.showToast({ title: '群聊已创建', icon: 'success' })
      this.backAndOpen(conv && conv.conversationId, title)
    } catch (e) { /* request 层已 toast */ }
  },

  // 回 messages 页并打开对应聊天浮层（loadAll 完成后列表里才有新会话）
  backAndOpen(conversationId, name) {
    wx.navigateBack({
      complete: function () {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && page.openChatAfterLoad) page.openChatAfterLoad(conversationId, name)
      }
    })
  }
})
