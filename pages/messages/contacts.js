// 选联系人页（期2 建群/私聊；2026-11-24 + 邀请入群）
// mode=group 多选建群 / mode=direct 单选私聊 / mode=invite 群聊邀请选人（2026-11-24）
//   建群：先选课程 → 花名册多选 + 输入群名 → POST /conversations {convType:'group', title, courseId, memberIds}
//   私聊：单选确认 → POST /conversations {convType:'direct', targetUserId}
//   邀请（2026-11-24 口径B改版）：搜索式选人——输入学号/工号/姓名调 search-user
//         （本校学生+教师全校可搜）；结果卡片右侧「添加」入已选；底部已选横滑栏（头像
//         右上角红叉可取消、头像下方姓名）；「发送邀请」统一批量 POST invitations；
//         已在群的人结果卡片显示「已在群聊」不可添加
const api = require('../../utils/api')
const FILE_BASE = require('../../utils/config').FILE_BASE_URL

/** 头像 URL 归一（2026-11-13）：http 原样；/api·/files 开头拼静态根；其余形态返回空走默认头像 */
function avatarUrl(u) {
  if (!u) return ''
  const s = String(u).trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.indexOf('/api/') === 0 || s.indexOf('/files/') === 0) return FILE_BASE + s
  return ''
}

Page({
  data: {
    mode: 'group',        // group=建群（多选） / direct=私聊（单选） / invite=群聊邀请（多选，2026-11-24）
    courses: [],           // [{courseId, courseName}]
    courseId: null,
    courseName: '',
    keyword: '',           // 姓名/学号搜索（本地过滤，列表一次拉全）
    roster: [],            // 全量花名册 [{studentId, name, studentNo}]
    filtered: [],           // 搜索过滤后的展示列表（附加 checked 标记）
    selected: {},          // group/invite 模式已选 {studentId: true}
    selectedCount: 0,
    loading: true,
    meId: null,            // 排除自己（私聊不能和自己）
    invitationId: null,    // invite 模式：目标群聊 ID
    // invite 模式搜索式选人（2026-11-24 口径B）
    searchKeyword: '',     // 搜索框内容（学号/工号/姓名）
    searchResults: [],     // 搜索结果卡片 [{userId,name,userNo,userType,jobTitle,avatarUrl,inGroup,added}]
    searching: false,      // 搜索请求进行中
    searchDone: false,     // 已执行过至少一次搜索（控制空态文案）
    selectedList: [],      // 已选列表（保序）[{userId,name,initial,avatarUrl,avatarShow}]
    inGroupIds: {}         // 群内成员集合 {userId: true}（结果卡片判「已在群聊」）
  },

  onLoad(options) {
    const mode = options.mode === 'direct' ? 'direct' : (options.mode === 'invite' ? 'invite' : 'group')
    this.setData({ mode: mode })
    // 邀请模式：搜索式选人（2026-11-24 口径B），courseId 不再限定选人范围
    if (mode === 'invite') {
      this.invitationId = Number(options.conversationId || 0)
      wx.setNavigationBarTitle({ title: '邀请入群', fail: function () {} })
      this.loadInvitePage()
      return
    }
    wx.setNavigationBarTitle({ title: mode === 'group' ? '发起群聊' : '发起私聊', fail: function () {} })
    this.loadMe()
  },

  // 邀请模式初始化：拉在群成员集合（搜索结果判「已在群聊」用）
  async loadInvitePage() {
    if (!this.invitationId) {
      wx.showToast({ title: '页面参数缺失', icon: 'none' })
      setTimeout(function () { wx.navigateBack({ fail: function () {} }) }, 900)
      return
    }
    this.setData({ loading: false })
    try {
      const memRes = await api.message.members(this.invitationId)
      const map = {}
      ;((memRes && memRes.list) || []).forEach(function (m) { map[m.userId] = true })
      this.setData({ inGroupIds: map })
    } catch (e) { /* 拉不到成员集合时仅失去「已在群聊」提示，发送时后端仍会 422 兜底 */ }
  },

  // 搜索框输入（invite 模式）：防抖 300ms 自动搜索
  onInviteSearchInput(e) {
    const kw = (e.detail.value || '').trim()
    this.setData({ searchKeyword: kw })
    if (this._inviteDebounce) clearTimeout(this._inviteDebounce)
    if (kw.length < 2) {
      this.setData({ searchResults: [], searchDone: false })
      return
    }
    const that = this
    this._inviteDebounce = setTimeout(function () { that.doInviteSearch(kw) }, 300)
  },

  // 调 search-user（本校学生+教师全校可搜），结果标记 inGroup / added
  async doInviteSearch(kw) {
    this.setData({ searching: true })
    try {
      const res = await api.message.searchUser(kw)
      const inGroupIds = this.data.inGroupIds
      const selected = this.data.selected
      const results = ((res && res.list) || []).map(function (u) {
        const name = u.name || u.userNo || ('用户 ' + u.userId)
        const av = avatarUrl(u.avatar)
        return {
          userId: u.userId, name: name, userNo: u.userNo || '',
          userType: u.userType === 'teacher' ? 'teacher' : 'student',
          jobTitle: u.jobTitle || '',
          avatarUrl: av, avatarShow: !!av, initial: name.slice(0, 1),
          inGroup: !!inGroupIds[u.userId], added: !!selected[u.userId]
        }
      })
      this.setData({ searchResults: results, searching: false, searchDone: true })
    } catch (e) {
      this.setData({ searchResults: [], searching: false, searchDone: true })
    }
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
          const av = avatarUrl(s.avatar)   // 2026-11-13：花名册接口新增 avatar，选人页展示真实头像
          return { studentId: s.studentId, name: name, initial: name.slice(0, 1),
                   studentNo: s.studentNo || '', avatarUrl: av, avatarShow: !!av }
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
    const fails = this.avFail || {}
    const list = this.data.roster.filter(function (s) {
      if (!kw) return true
      return (s.name || '').toLowerCase().indexOf(kw) >= 0 || (s.studentNo || '').toLowerCase().indexOf(kw) >= 0
    }).map(function (s) {
      return Object.assign({}, s, { checked: !!sel[s.studentId], avFail: !!fails[s.studentId] })
    })
    this.setData({ filtered: list })
  },

  // 头像加载失败兜底（2026-11-16）：binderror 记忆到 avFail 映射（搜索重渲染后仍生效）
  onAvError(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.avFail = this.avFail || {}
    this.avFail[id] = true
    const upd = {}
    this.data.filtered.forEach(function (s, i) {
      if (s.studentId === id) upd['filtered[' + i + '].avFail'] = true
    })
    this.setData(upd)
  },

  // 搜索结果卡片「添加」（invite 模式）：入已选横滑栏；已在群/已选不可添加
  tapAdd(e) {
    const id = Number(e.currentTarget.dataset.id)
    const u = this.data.searchResults.find(function (x) { return x.userId === id })
    if (!u || u.inGroup || u.added) return
    const selected = Object.assign({}, this.data.selected)
    selected[id] = true
    const sel = {
      userId: id, name: u.name, initial: u.name.slice(0, 1),
      avatarUrl: u.avatarUrl, avatarShow: u.avatarShow
    }
    const idx = this.data.searchResults.indexOf(u)
    this.setData({
      selected: selected,
      selectedList: this.data.selectedList.concat([sel]),
      selectedCount: this.data.selectedList.length + 1,
      ['searchResults[' + idx + '].added']: true
    })
  },

  // 已选头像右上角红叉（invite 模式）：取消选中并同步结果卡片
  removeSelected(e) {
    const id = Number(e.currentTarget.dataset.id)
    const selected = Object.assign({}, this.data.selected)
    delete selected[id]
    const list = this.data.selectedList.filter(function (x) { return x.userId !== id })
    const patch = { selected: selected, selectedList: list, selectedCount: list.length }
    const idx = this.data.searchResults.findIndex(function (x) { return x.userId === id })
    if (idx >= 0) patch['searchResults[' + idx + '].added'] = false
    this.setData(patch)
  },

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

  // 邀请入群（2026-11-24）：批量逐人 POST invitations；结果汇总提示
  async sendInvites() {
    const ids = Object.keys(this.data.selected).map(Number)
    if (!ids.length) {
      wx.showToast({ title: '请先通过搜索添加要邀请的人', icon: 'none' })
      return
    }
    const that = this
    wx.showModal({
      title: '发送邀请（已选 ' + ids.length + ' 人）',
      content: '将向所选同学发送群聊邀请，对方同意后加入。',
      success(res) {
        if (!res.confirm) return
        that.doSendInvites(ids)
      }
    })
  },

  async doSendInvites(ids) {
    wx.showLoading({ title: '发送中…', mask: true })
    let ok = 0, fail = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.message.invite(this.invitationId, { inviteeId: ids[i] })
        ok++
      } catch (e) { fail++ }
    }
    wx.hideLoading()
    if (ok) wx.showToast({ title: '已发出 ' + ok + ' 份邀请' + (fail ? '（' + fail + ' 人失败）' : ''), icon: 'none' })
    setTimeout(function () { wx.navigateBack({ fail: function () {} }) }, ok ? 1100 : 0)
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
