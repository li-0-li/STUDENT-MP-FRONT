// 消息通知 —— 原型：ui-prototype/mp/app-messages.html（UI 设计文档 7.14）
// 聚合「系统通知 + 师生会话」两类：顶部 通知/会话 切换 tab
// 接入：messageApi.notifications（表 2-13 通知列表）/ conversations（表 2-10 会话列表）
//   / messages（表 2-12 消息记录，倒序返回，拉取即清本人未读）
//   / send（表 2-11 发送消息）/ markRead（表 2-17 通知已读）/ unreadCount（tabBar 角标）
//   / create（新增一对一会话，右下角 +）/ remove（删除通知 / 会话，长按触发）
const api = require('../../utils/api')

// 会话头像配色（按列表顺序循环）
const COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0369a1']

// 时间解析（后端形如 2026-10-08T10:54:16，'-' 转 '/' 兼容 iOS）
function parseISO(iso) {
  if (!iso) return null
  return new Date(String(iso).replace('T', ' ').replace(/-/g, '/'))
}

function pad(n) { return ('0' + n).slice(-2) }

// 列表时间展示：今天→HH:mm，昨天→昨天，同年→MM-DD，跨年→YYYY-MM-DD
function fmtListTime(iso) {
  const d = parseISO(iso)
  if (!d) return ''
  const now = new Date()
  const sameDate = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDate(d, now)) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (sameDate(d, yesterday)) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function fmtHM(iso) {
  const d = parseISO(iso)
  return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''
}

function nowHM() {
  const d = new Date()
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// 会话条目（表 2-10）→ 列表展示字段；conv_type=notice 的系统会话由「通知」tab 覆盖
function mapConv(c, idx) {
  const isGroup = c.conv_type === 'group'
  const name = c.title || '会话'
  return {
    id: c.conversation_id,
    name,
    sub: isGroup ? ((c.class_name ? c.class_name + ' · ' : '') + '课程群聊') : '私聊',
    color: COLORS[idx % COLORS.length],
    time: fmtListTime(c.last_message_time),
    unread: c.unread_count || 0,
    initial: name.slice(0, 1),
    last: c.last_message || ''
  }
}

Page({
  data: {
    tab: 'notice',     // notice=系统通知 / chat=师生会话
    loading: true,
    notices: [],
    chats: [],
    // 聊天详情（页内浮层，表 2-11/2-12）
    chatOpen: false,
    chat: {},
    chatInput: '',
    chatScrollInto: ''
  },

  onShow() { this.loadAll() },

  async loadAll() {
    this.setData({ loading: true })
    // 先取本人 ID（会话 directKey 判别对方要用）
    await this.loadMe()
    await Promise.all([this.loadNotices(), this.loadChats()])
    this.setData({ loading: false })
    this.refreshBadge()
  },

  // 当前用户 ID（表 2-14），用于区分聊天记录里自己/对方的消息
  async loadMe() {
    try {
      const u = await api.user.me()
      this.myUserId = u && u.userId
    } catch (e) { /* request 层已 toast */ }
  },

  // 教师通讯录（teacherId → 姓名）：表 3-1 列表给姓名、表 3-2 详情给 ID。
  // 懒加载 + 会话级缓存：会话补名与「+」联系人选择共用
  async ensureTeacherMap() {
    if (this.teacherMap) return this.teacherMap
    try {
      const res = await api.course.listMine({ page: 1, pageSize: 100 })
      const courses = (res && res.list) || []
      const details = await Promise.all(
        courses.map(function (c) { return api.course.detail(c.courseId).catch(function () { return null }) })
      )
      const map = {}
      courses.forEach(function (c, i) {
        const d = details[i]
        const id = d && d.course && d.course.teacherId
        if (id) map[id] = c.teacherName || (d.course.teacherName || '教师 ' + id)
      })
      this.teacherMap = map
    } catch (e) {
      this.teacherMap = {}
    }
    return this.teacherMap
  },

  // 私聊会话对方 userId：directKey 形如 "1001_1002"（双方 ID），取不是自己的那端；
  // 本人 ID 未知时用 created_by（创建者）判别
  peerIdOf(c) {
    const ids = String(c.direct_key || '').split('_').filter(function (x) { return x })
    if (!ids.length) return null
    if (this.myUserId != null) return Number(ids[0] == this.myUserId ? ids[1] : ids[0])
    if (c.created_by != null) return Number(ids[0] == c.created_by ? ids[1] : ids[0])
    return null
  },

  async loadNotices() {
    try {
      const list = await api.message.notifications()
      const notices = (list || []).map(function (n) {
        return {
          id: n.notice_id,
          title: n.title || '通知',
          text: n.content || '',
          time: fmtListTime(n.create_time),
          unread: !n.is_read
        }
      })
      this.setData({ notices })
    } catch (e) {
      // request 层已 toast
    }
  },

  async loadChats() {
    try {
      const list = await api.message.conversations()
      // M-E 会话列表对私聊不返回标题（title=null）：从 directKey 解析对方 ID，
      // 用「我学的课」的教师通讯录补名，避免整列会话都显示兜底名「会话」
      const noTitle = (list || []).filter(function (c) { return c.conv_type === 'direct' && !c.title })
      if (noTitle.length) {
        const tmap = await this.ensureTeacherMap()
        const that = this
        noTitle.forEach(function (c) {
          const peer = that.peerIdOf(c)
          if (peer != null && tmap[peer]) c.title = tmap[peer]
        })
      }
      const chats = (list || [])
        .filter(function (c) { return c.conv_type !== 'notice' })
        .map(mapConv)
      this.setData({ chats })
    } catch (e) {
      // request 层已 toast
    }
  },

  // 未读汇总（通知 + 会话）→ tabBar 角标
  refreshBadge() {
    api.message.unreadCount().then((s) => {
      const n = (s && s.total) || 0
      if (n > 0) {
        wx.setTabBarBadge({ index: 3, text: n > 99 ? '99+' : String(n), fail: function () {} })
      } else {
        wx.removeTabBarBadge({ index: 3, fail: function () {} })
      }
    }).catch(function () {})
  },

  // 切换 通知 / 会话 tab
  selectTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key })
  },

  // 系统通知：点击标记已读（表 2-17）
  openNotice(e) {
    const id = e.currentTarget.dataset.id
    const idx = this.data.notices.findIndex(function (n) { return n.id === id })
    if (idx < 0) return
    const n = this.data.notices[idx]
    wx.showModal({
      title: n.title || '通知',
      content: ((n.text || '') + (n.time ? '\n\n' + n.time : '')) || '（无正文）',
      showCancel: false
    })
    if (n.unread) {
      this.setData({ ['notices[' + idx + '].unread']: false })
      const that = this
      api.message.markRead({ noticeIds: [id] })
        .then(function () { that.refreshBadge() })
        .catch(function () {})
    }
  },

  // 会话：进入聊天详情（拉取即清本人未读）
  openChat(e) { this.openChatById(e.currentTarget.dataset.id) },

  async openChatById(id, nameOverride) {
    const idx = this.data.chats.findIndex(function (c) { return c.id === id })
    if (idx < 0) return
    const conv = this.data.chats[idx]
    // 会话列表 direct 会话标题常为空（显示「会话」），调用方可用 nameOverride 带入对方姓名
    const name = (conv.name && conv.name !== '会话' && conv.name) || nameOverride || conv.name
    this.setData({
      chatOpen: true,
      chat: { id, name, sub: conv.sub, msgs: [] },
      chatInput: ''
    })
    // 聊天为全屏浮层：打开时隐藏 tabBar（本页是 tabBar 页），关闭时恢复
    wx.hideTabBar({ animation: false, fail: function () {} })
    this.setData({ ['chats[' + idx + '].unread']: 0 })
    try {
      const list = await api.message.messages(id)
      // 后端按 message_id 倒序返回，正序展示
      const that = this
      const msgs = (list || []).slice().reverse().map(function (m) {
        return {
          from: m.sender_id === that.myUserId ? 'me' : 'them',
          text: m.content || '',
          time: fmtHM(m.send_time)
        }
      })
      this.setData({ 'chat.msgs': msgs })
      this.scrollBottom()
    } catch (e) {
      // request 层已 toast，浮层保留（可重进会话重试）
    }
  },

  closeChat() {
    this.setData({ chatOpen: false })
    // 恢复 tabBar（打开聊天浮层时隐藏过）
    wx.showTabBar({ animation: false, fail: function () {} })
  },

  // 聊天输入 / 发送（表 2-11，服务端返回 messageId + sendTime）
  onChatInput(e) { this.setData({ chatInput: e.detail.value }) },

  async sendChat() {
    const v = this.data.chatInput.trim()
    if (!v || this.sending) return
    this.sending = true
    try {
      const res = await api.message.send(this.data.chat.id, { msgType: 'text', content: v })
      const msgs = this.data.chat.msgs.concat([{ from: 'me', text: v, time: (res && res.sendTime) || nowHM() }])
      this.setData({ 'chat.msgs': msgs, chatInput: '' })
      this.scrollBottom()
    } catch (e) {
      // request 层已 toast，保留输入便于重试
    }
    this.sending = false
  },

  // 发起新对话：从「我学的课」取任课教师 → 选择 → 调新增会话接口（幂等）→ 刷新并进入聊天
  // 教师通讯录由 ensureTeacherMap 提供（表 3-1 给姓名 + 表 3-2 详情补 ID）
  async askTeacher() {
    if (this.picking) return
    this.picking = true
    try {
      const tmap = await this.ensureTeacherMap()
      const teachers = Object.keys(tmap).map(function (id) {
        return { id: Number(id), name: tmap[id] }
      })
      if (!teachers.length) {
        wx.showToast({ title: '暂无可发起对话的任课教师', icon: 'none' })
        return
      }
      const that = this
      wx.showActionSheet({
        itemList: teachers.slice(0, 6).map(function (t) {
          return t.name.length > 12 ? t.name.slice(0, 12) + '…' : t.name
        }),
        success(res2) {
          const t = teachers[res2.tapIndex]
          if (t) that.createConversation(t)
        }
      })
    } catch (e) {
      // request 层已 toast
    }
    this.picking = false
  },

  // 调新增会话接口（后端幂等：已有一对一会话则复用）→ 刷新列表并进入聊天。
  // 会话列表（M-E）对 direct 会话不返回标题，进入聊天时用创建结果里的 peerName 兜底显示
  async createConversation(teacher) {
    try {
      const conv = await api.message.create({ targetUserId: teacher.id, convType: 'direct' })
      await this.loadChats()
      this.refreshBadge()
      if (conv && conv.conversationId) {
        this.openChatById(conv.conversationId, conv.title || conv.peerName || teacher.name)
      }
    } catch (e) {
      // request 层已 toast
    }
  },

  // 长按删除系统通知（软删，仅本人）
  deleteNotice(e) {
    const id = e.currentTarget.dataset.id
    const n = this.data.notices.find(function (x) { return x.id === id })
    const that = this
    wx.showModal({
      title: '删除通知',
      content: '确定删除「' + ((n && n.title) || '通知') + '」吗？',
      success(res) {
        if (res.confirm) that.doDelete('notice', id)
      }
    })
  },

  // 长按删除会话（本人退出，从我的列表移除；会话与消息对其他成员保留）
  deleteChat(e) {
    const id = e.currentTarget.dataset.id
    const c = this.data.chats.find(function (x) { return x.id === id })
    const that = this
    wx.showModal({
      title: '删除会话',
      content: '确定删除与「' + ((c && c.name) || '该用户') + '」的会话吗？删除后仅从你的列表移除。',
      success(res) {
        if (res.confirm) that.doDelete('conversation', id)
      }
    })
  },

  async doDelete(targetType, id) {
    try {
      await api.message.remove({ targetType: targetType, targetIds: [id] })
      if (targetType === 'notice') {
        this.setData({ notices: this.data.notices.filter(function (n) { return n.id !== id }) })
      } else {
        this.setData({ chats: this.data.chats.filter(function (c) { return c.id !== id }) })
      }
      this.refreshBadge()
    } catch (e) {
      // request 层已 toast
    }
  },

  // 聊天浮层滚到底部（scroll-into-view 锚点，等消息渲染完成后再定位）
  scrollBottom() {
    const that = this
    this.setData({ chatScrollInto: '' }, function () {
      setTimeout(function () { that.setData({ chatScrollInto: 'm-bottom' }) }, 60)
    })
  }
})
