// 消息通知 —— 原型：ui-prototype/mp/app-messages.html（UI 设计文档 7.14）
// 聚合「系统通知 + 师生会话」两类：顶部 通知/会话 切换 tab
// 接入：messageApi.notifications（表 2-13 通知列表）/ conversations（表 2-10 会话列表）
//   / messages（表 2-12 消息记录，倒序返回，拉取即清本人未读）
//   / send（表 2-11 发送消息）/ markRead（表 2-17 通知已读）/ unreadCount（tabBar 角标）
//   / create（新增一对一会话，右下角 +）/ remove（删除通知 / 会话，长按触发）
const api = require('../../utils/api')
const FILE_BASE = require('../../utils/config').FILE_BASE_URL

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

// 文件相对路径 → 绝对 URL（file_url 形如 /files/xxx，需拼后端 host；http 开头的透传）
function absUrl(u) {
  return u ? (String(u).indexOf('http') === 0 ? u : FILE_BASE + u) : ''
}

// 文件大小展示（B/KB/MB）
function fmtBytes(n) {
  if (!n || n <= 0) return ''
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB'
  return (n / 1024 / 1024).toFixed(1) + 'MB'
}

// 期3修订：图库/拍摄没有原始文件名，构造 IMG_/VIDEO_ + 时间戳 + 保留扩展名
function buildMediaName(msgType, filePath) {
  const ext = (String(filePath).match(/\.(\w+)$/) || [])[0] || (msgType === 'video' ? '.mp4' : '.jpg')
  return (msgType === 'video' ? 'VIDEO_' : 'IMG_') + Date.now() + ext
}

// 期3修订：wx.uploadFile 把 filePath 的 basename 当 multipart 文件名，而临时文件是随机串
// （用户上传后文件名显示为乱码随机串的根因）——先复制到 USER_DATA_PATH/<展示名> 再上传
function ensureNicePath(filePath, wantName) {
  return new Promise(function (resolve) {
    try {
      const fs = wx.getFileSystemManager()
      const safe = String(wantName).replace(/[\/\\:*?"<>|]/g, '_').slice(-80)
      const dest = wx.env.USER_DATA_PATH + '/' + safe
      fs.copyFile({
        srcPath: filePath,
        destPath: dest,
        success() { resolve(dest) },
        fail() { resolve(filePath) }
      })
    } catch (e) { resolve(filePath) }
  })
}

// 消息记录（表 2-12 兼容层 snake_case）→ 聊天气泡视图模型（期3：type/url/name/recalled）
function mapMsg(m, myUserId) {
  return {
    id: m.message_id,
    from: m.sender_id === myUserId ? 'me' : 'them',
    type: m.msg_type || 'text',
    text: m.content || '',
    time: fmtHM(m.send_time),
    url: absUrl(m.file_url),
    name: m.file_name || '',
    size: fmtBytes(m.file_size),
    recalled: !!(m.is_recalled)
  }
}

// 会话条目（表 2-10）→ 列表展示字段；conv_type=notice 的系统会话由「通知」tab 覆盖
function mapConv(c, idx) {
  const type = c.conv_type
  const name = c.title || '会话'
  // direct=私聊 / group=学生自建群（期2）/ course_group=教师建的课程群
  const sub = type === 'direct' ? '私聊'
    : type === 'group' ? '群聊'
    : type === 'course_group' ? ((c.class_name ? c.class_name + ' · ' : '') + '课程群聊')
    : '会话'
  return {
    id: c.conversation_id,
    type,
    name,
    sub,
    color: COLORS[idx % COLORS.length],
    time: fmtListTime(c.last_message_time),
    unread: c.unread_count || 0,
    pinned: !!(c.is_pinned),
    muted: !!(c.is_muted),
    initial: name.slice(0, 1),
    last: c.last_message || ''
  }
}

// 通知按课程分组：biz_type 为课程类（course/course_announce/announce）且带 biz_id → 课程组，其余归「系统」组
const COURSE_BIZ = ['course', 'course_announce', 'announce']
function noticeGroupKey(n) {
  return (COURSE_BIZ.indexOf(n.biz_type) >= 0 && n.biz_id) ? Number(n.biz_id) : 0
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

  // 课程名映射（courseId → 课程名）：通知分组用，懒加载 + 缓存
  async ensureCourseMap() {
    if (this.courseMap) return this.courseMap
    try {
      const res = await api.course.listMine({ page: 1, pageSize: 100 })
      const map = {}
      ;((res && res.list) || []).forEach(function (c) { map[c.courseId] = c.courseName || ('课程 ' + c.courseId) })
      this.courseMap = map
    } catch (e) {
      this.courseMap = {}
    }
    return this.courseMap
  },

  // 通知列表（表 2-13）→ 按课程分组为「文件夹」（biz_type/biz_id 关联课程；非课程通知归「系统」组）
  // 文件夹只带组标识/标题/未读标记，条目详情由 course-notice 子页展示（两处分组判定保持一致）
  async loadNotices() {
    try {
      const list = await api.message.notifications()
      const cmap = await this.ensureCourseMap()
      // groupId=0 为「系统通知」组；课程组按最近通知时间排序在前
      const groups = { 0: { title: '系统通知', unread: false, time: '', count: 0 } }
      const order = []
      ;(list || []).forEach(function (n) {
        const gid = noticeGroupKey(n)
        if (!groups[gid]) {
          groups[gid] = { title: cmap[gid] || '课程 ' + gid, unread: false, time: n.create_time, count: 0 }
          order.push(gid)
        }
        groups[gid].count++
        if (!n.is_read) groups[gid].unread = true
      })
      order.sort((a, b) => String(groups[b].time || '').localeCompare(String(groups[a].time || '')))
      const orderKeys = order.filter((g) => g !== 0)
      if (groups[0].count) orderKeys.push(0)
      // 每个文件夹带真实分组 key（gid），跳转子页时作为过滤条件
      const sections = orderKeys.map(function (g) {
        return { id: g, gid: g, title: groups[g].title, unread: groups[g].unread }
      })
      this.setData({ notices: sections })
    } catch (e) {
      // request 层已 toast
    }
  },

  // 点击课程文件夹 → 跳转该课程通告子页（系统通知组同理）
  openFolder(e) {
    const idx = e.currentTarget.dataset.idx
    const s = this.data.notices[idx]
    if (!s) return
    // groupId 用分组时的真实 key（存回 s.gid）
    wx.navigateTo({
      url: '/pages/messages/course-notice?groupId=' + s.gid + '&title=' + encodeURIComponent(s.title)
    })
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
      chat: { id, name, sub: conv.sub, type: conv.type, msgs: [] },
      chatInput: ''
    })
    // 聊天为全屏浮层：打开时隐藏 tabBar（本页是 tabBar 页），关闭时恢复
    wx.hideTabBar({ animation: false, fail: function () {} })
    this.setData({ ['chats[' + idx + '].unread']: 0 })
    // 标记会话已读（服务端清零未读数 + 记录已读位点）
    api.message.read(id).catch(function () {})
    // 期3 状态复位：无更多历史标记清零（搜索已改为独立页面 chat-records）
    this.noMoreHistory = false
    try {
      const list = await api.message.messages(id)
      // 兼容层已返回最新一页正序（beforeId=MAX 模式），直接展示
      const that = this
      const msgs = (list || []).map(function (m) { return mapMsg(m, that.myUserId) })
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

  // 建群/私聊完成后回本页打开新会话（contacts 页 backAndOpen 调用；
  // 先 loadAll 保证新会话进列表，再开浮层）
  async openChatAfterLoad(id, name) {
    if (!id) return
    await this.loadAll()
    this.openChatById(id, name)
  },

  // 聊天浮层标题点击：群聊 → 群成员页（期2）；私聊/未知类型不响应
  openMembers() {
    if (this.data.chat.type !== 'group') return
    wx.navigateTo({ url: '/pages/messages/members?conversationId=' + this.data.chat.id })
  },

  // 聊天输入 / 发送（表 2-11，服务端返回 messageId + sendTime）
  onChatInput(e) { this.setData({ chatInput: e.detail.value }) },

  async sendChat() {
    const v = this.data.chatInput.trim()
    if (!v || this.sending) return
    this.sending = true
    try {
      const res = await api.message.send(this.data.chat.id, { msgType: 'text', content: v })
      const msgs = this.data.chat.msgs.concat([{
        id: res && res.messageId, from: 'me', type: 'text', text: v,
        time: (res && res.sendTime) || nowHM(), recalled: false
      }])
      this.setData({ 'chat.msgs': msgs, chatInput: '' })
      this.scrollBottom()
    } catch (e) {
      // request 层已 toast，保留输入便于重试
    }
    this.sending = false
  },

  // 期3修订：输入栏「+」→ 发图片 / 发视频 / 发文件
  chatPlus() {
    const that = this
    wx.showActionSheet({
      itemList: ['发送图片', '发送视频', '发送文件'],
      success(res) {
        if (res.tapIndex === 0) that.pickImage()
        else if (res.tapIndex === 1) that.pickVideo()
        else if (res.tapIndex === 2) that.pickFile()
      }
    })
  },

  // 选本地视频 → 上传 → 发 video 消息（期3修订）
  pickVideo() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      success(res) {
        if (res.tempFiles && res.tempFiles.length) {
          const f = res.tempFiles[0]
          that.uploadAndSend('video', f.tempFilePath, f.size)
        }
      }
    })
  },

  // 选本地图片 → 上传 → 发 image 消息
  pickImage() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success(res) {
        if (res.tempFiles && res.tempFiles.length) that.uploadAndSend('image', res.tempFiles[0].tempFilePath, res.tempFiles[0].size)
      }
    })
  },

  // 选本地文件（小程序从聊天记录选文件）→ 上传 → 发 file 消息
  pickFile() {
    const that = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success(res) {
        if (res.tempFiles && res.tempFiles.length) {
          const f = res.tempFiles[0]
          that.uploadAndSend('file', f.path, f.size, f.name)
        }
      }
    })
  },

  // 上传（POST /files/upload）→ 发对应类型消息 → 追加气泡
  // 期3修订：文件名优先用本地原始名 nameOverride；无原始名（图库/拍摄）构造 IMG_/VIDEO_ 时间戳名
  async uploadAndSend(msgType, filePath, size, nameOverride) {
    if (this.sending) return
    this.sending = true
    wx.showLoading({ title: '发送中…', mask: true })
    try {
      const niceName = nameOverride || buildMediaName(msgType, filePath)
      // wx.uploadFile 用 basename 当 multipart 文件名，临时文件是随机串：
      // 先复制到用户目录的展示名路径，服务端才能存到真实文件名
      const upPath = await ensureNicePath(filePath, niceName)
      const up = await api.message.uploadFile(upPath)
      const payload = { msgType: msgType, fileUrl: up && up.url, fileName: nameOverride || (up && up.fileName) || niceName, fileSize: (up && up.size) || size }
      const res = await api.message.send(this.data.chat.id, payload)
      const msgs = this.data.chat.msgs.concat([{
        id: res && res.messageId, from: 'me', type: msgType,
        text: '', url: absUrl(payload.fileUrl), name: payload.fileName, size: fmtBytes(payload.fileSize),
        time: (res && res.sendTime) || nowHM(), recalled: false
      }])
      this.setData({ 'chat.msgs': msgs })
      this.scrollBottom()
    } catch (e) {
      // request 层已 toast
    }
    wx.hideLoading()
    this.sending = false
  },

  // 期3/期4：长按气泡 → 撤回（仅本人）/ 转发（任何人）/ 举报（他人消息）
  longPressMsg(e) {
    const idx = e.currentTarget.dataset.idx
    const m = this.data.chat.msgs[idx]
    if (!m || m.recalled) return
    const that = this
    const items = m.from === 'me' ? ['撤回', '转发'] : ['转发', '举报']
    wx.showActionSheet({
      itemList: items,
      success(res) {
        const tap = items[res.tapIndex]
        if (tap === '撤回') that.doRecall(idx)
        else if (tap === '转发') that.forwardMsg(m)
        else if (tap === '举报') that.doReport(m)
      }
    })
  },

  async doRecall(idx) {
    const m = this.data.chat.msgs[idx]
    if (!m || !m.id) return
    try {
      await api.message.recall(m.id)
      this.setData({ ['chat.msgs[' + idx + '].recalled']: true })
    } catch (e) { /* request 层已 toast */ }
  },

  // 期4：举报他人消息（理由弹窗，2-100 字）→ 通知投递给任课教师/平台管理员
  doReport(m) {
    if (!m || !m.id) return
    const that = this
    wx.showModal({
      title: '举报该消息',
      editable: true,
      placeholderText: '请输入举报理由（2-100 字）',
      success(res) {
        if (!res.confirm) return
        api.message.report(m.id, (res.content || '').trim())
          .then(function () {
            wx.showToast({ title: '已提交，任课教师将在通知中收到', icon: 'none', duration: 2500 })
          })
          .catch(function () { /* request 层已 toast（重复举报 409 等口径） */ })
      }
    })
  },

  // 转发：选择目标会话 → 原样发送（text→content；image/file→fileUrl 透传）
  forwardMsg(m) {
    const chats = this.data.chats.filter(function (c) { return c.id !== undefined })
    if (!chats.length) {
      wx.showToast({ title: '暂无其他可转发的会话', icon: 'none' })
      return
    }
    const that = this
    wx.showActionSheet({
      itemList: chats.slice(0, 6).map(function (c) { return c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name }),
      success(res) {
        const target = chats[res.tapIndex]
        if (!target) return
        const payload = m.type === 'text'
          ? { msgType: 'text', content: m.text }
          : { msgType: m.type, fileUrl: m.url, fileName: m.name, fileSize: 0 }
        api.message.send(target.id, payload)
          .then(function () { wx.showToast({ title: '已转发给「' + target.name + '」', icon: 'none' }) })
          .catch(function () {})
      }
    })
  },

  // 期3：上拉加载历史（beforeId = 当前列表最旧一条）
  async loadHistory() {
    const msgs = this.data.chat.msgs
    if (!this.data.chatOpen || this.noMoreHistory || !msgs.length || this.loadingHistory) return
    this.loadingHistory = true
    try {
      const older = await api.message.messagesBefore(this.data.chat.id, msgs[0].id, 20)
      if (!older || older.length < 20) this.noMoreHistory = true
      if (older && older.length) {
        const that = this
        const more = older.map(function (m) { return mapMsg(m, that.myUserId) })
        // 保持视野：记录当前首条 id，拼接后 scroll-into 到它
        const anchor = 'm-' + msgs[0].id
        this.setData({ 'chat.msgs': more.concat(msgs) }, function () {
          that.setData({ chatScrollInto: anchor })
        })
      }
    } catch (e) { /* request 层已 toast */ }
    this.loadingHistory = false
  },

  // 期3修订：聊天记录搜索改为独立页面（群聊支持按人员/类型，私聊按类型）
  openRecords() {
    const c = this.data.chat
    if (!c || !c.id) return
    wx.navigateTo({
      url: '/pages/messages/chat-records?conversationId=' + c.id + '&type=' + (c.type || '') + '&name=' + encodeURIComponent(c.name || '')
    })
  },

  // 期3：群聊标题「···」菜单：群成员 / 群文件
  groupMenu() {
    if (this.data.chat.type !== 'group') return
    const that = this
    wx.showActionSheet({
      itemList: ['群成员', '群文件'],
      success(res) {
        if (res.tapIndex === 0) that.openMembers()
        else wx.navigateTo({ url: '/pages/messages/group-files?conversationId=' + that.data.chat.id })
      }
    })
  },

  // 图片消息点按 → 全屏预览（当前会话内所有图片可左右滑）
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = this.data.chat.msgs.filter(function (m) { return m.type === 'image' && m.url && !m.recalled })
      .map(function (m) { return m.url })
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  // 文件消息点按 → 下载后用文档预览打开
  openFile(e) {
    const url = e.currentTarget.dataset.url
    const name = e.currentTarget.dataset.name || '文件'
    if (!url) return
    wx.showLoading({ title: '下载中…', mask: true })
    wx.downloadFile({
      url: url,
      success(res) {
        wx.hideLoading()
        wx.openDocument({
          filePath: res.tempFilePath,
          showMenu: true,
          fail() { wx.showToast({ title: '该文件类型暂不支持预览', icon: 'none' }) }
        })
      },
      fail() {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  // 右下角「＋」：建群 / 私聊同学 / 联系任课教师（期2 前两项走 contacts 选人页）
  fabTap() {
    const that = this
    wx.showActionSheet({
      itemList: ['发起群聊', '私聊同学', '联系任课教师'],
      success(res) {
        if (res.tapIndex === 0) wx.navigateTo({ url: '/pages/messages/contacts?mode=group' })
        else if (res.tapIndex === 1) wx.navigateTo({ url: '/pages/messages/contacts?mode=direct' })
        else that.askTeacher()
      }
    })
  },

  // 联系任课教师（快捷入口，保留）：从「我学的课」取任课教师 → 选择 → 调新增会话接口（幂等）→ 刷新并进入聊天
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

  // 长按会话：操作菜单（置顶 / 免打扰 / 删除，成员维度均只影响本人）
  deleteChat(e) {
    const id = e.currentTarget.dataset.id
    const c = this.data.chats.find(function (x) { return x.id === id })
    const that = this
    wx.showActionSheet({
      itemList: [
        c && c.pinned ? '取消置顶' : '置顶该会话',
        c && c.muted ? '开启消息提醒' : '免打扰',
        '删除会话'
      ],
      success(res) {
        if (res.tapIndex === 0) that.togglePrefs(id, { isPinned: c && c.pinned ? 0 : 1 })
        else if (res.tapIndex === 1) that.togglePrefs(id, { isMuted: c && c.muted ? 0 : 1 })
        else if (res.tapIndex === 2) {
          wx.showModal({
            title: '删除会话',
            content: '确定删除与「' + ((c && c.name) || '该用户') + '」的会话吗？删除后仅从你的列表移除。',
            success(r2) {
              if (r2.confirm) that.doDelete('conversation', id)
            }
          })
        }
      }
    })
  },

  // 切换置顶/免打扰 → 服务端落 conversation_member → 重拉会话列表（置顶会改变排序）
  async togglePrefs(id, prefs) {
    try {
      await api.message.prefs(id, prefs)
      await this.loadChats()
      wx.showToast({ title: '设置已更新', icon: 'success' })
    } catch (e) {
      // request 层已 toast
    }
  },

  async doDelete(targetType, id) {
    try {
      await api.message.remove({ targetType: targetType, targetIds: [id] })
      if (targetType === 'conversation') {
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
