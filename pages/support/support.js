// 客服与帮助 —— 原型：ui-prototype/mp/app-support.html（文档 7.17：FAQ 顶部搜索 + 意见反馈）
// 接入：supportApi.consult（表 3-20 咨询提交，自动建单并智能应答）
//   / tickets（表 3-23 会话列表）/ messages（表 3-24 消息查询）/ sendMessage（表 3-25 发送）
const api = require('../../utils/api')

// FAQ 为帮助中心静态文案（非接口数据），支持本地搜索
const ALL_FAQS = [
  {
    q: '如何添加课程？',
    a: '进入「课程」页，点右上角「添加课程」，输入教师提供的课程码即可加入；公开课可直接在课程列表中申请加入。加入后课程会同步出现在首页课表与「我的作业」中。',
    open: false
  },
  {
    q: '作业提交后多久能批改？',
    a: '单选、多选、判断、填空提交后立即出分；简答题由 AI 评分后直接生效，教师复核后可修正；编程题提交后自动运行测试用例判分。教师完成批改会在「消息」中通知，也可在「我的 → 我的作业」查看结果与评语。',
    open: false
  },
  {
    q: '如何修改登录密码？',
    a: '进入「我的 → 设置 → 修改密码」，输入原密码与新密码即可。若原密码已遗忘，请在登录页点「忘记密码」，通过绑定的手机号或邮箱验证后重置。',
    open: false
  }
]

function pad(n) { return ('0' + n).slice(-2) }
function nowHM() {
  const d = new Date()
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}
// 后端时间（2026-10-08T10:54:16）→ HH:mm（'-' 转 '/' 兼容 iOS）
function fmtHM(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).replace('T', ' ').replace(/-/g, '/'))
  return isNaN(d.getTime()) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes())
}

Page({
  data: {
    faqs: ALL_FAQS,        // 全量 FAQ（含 open 状态）
    shownFaqs: ALL_FAQS,   // 搜索过滤后的展示列表
    keyword: '',           // FAQ 搜索关键词
    // 可咨询的问题范围
    tags: ['账号与登录', '课程与资源', '作业与批改', '实验报告', '学情数据', '其他'],
    // 意见反馈弹层
    feedbackOpen: false,
    fbContent: '',
    fbContact: '',
    // 在线客服会话浮层（表 3-23~3-25）
    chatOpen: false,
    chat: { id: null, name: '在线客服', sub: '智能助教先答，必要时转人工', msgs: [] },
    chatInput: '',
    chatScrollTop: 0
  },

  onShow() { this.loadTickets() },

  // 我的客服会话（表 3-23），供「选择会话/新开咨询」操作面板使用
  async loadTickets() {
    try {
      const list = await api.support.tickets()
      this.tickets = list || []
    } catch (e) {
      // request 层已 toast
      this.tickets = this.tickets || []
    }
  },

  // FAQ 搜索（本地过滤）
  onSearch(e) {
    const kw = (e.detail.value || '').trim()
    const shownFaqs = kw
      ? ALL_FAQS.filter((f) => f.q.indexOf(kw) >= 0 || f.a.indexOf(kw) >= 0)
      : ALL_FAQS
    this.setData({ keyword: e.detail.value, shownFaqs })
  },
  clearSearch() {
    this.setData({ keyword: '', shownFaqs: ALL_FAQS })
  },

  // 展开/收起手风琴
  toggleFaq(e) {
    const i = e.currentTarget.dataset.i
    const item = this.data.shownFaqs[i]
    // 同步 open 状态到展示列表
    this.setData({ ['shownFaqs[' + i + '].open']: !item.open })
  },

  // 联系人工客服：优先继续已有工单会话，也可新开咨询（表 3-20）
  contactStaff() {
    const tickets = (this.tickets || []).slice(0, 5)
    const items = tickets.map(function (t) {
      const s = t.subject || '咨询'
      return s.length > 14 ? s.slice(0, 14) + '…' : s
    })
    items.push(tickets.length ? '＋ 新开咨询' : '开始咨询')
    const that = this
    wx.showActionSheet({
      itemList: items,
      success(res) {
        const i = res.tapIndex
        if (i < tickets.length) that.openTicket(tickets[i].ticket_id, tickets[i].subject)
        else that.openTicket(null)
      }
    })
  },

  // 打开客服会话浮层：ticketId 为空表示新咨询（首条消息走表 3-20 建单）
  openTicket(ticketId, subject) {
    this.setData({
      chatOpen: true,
      chat: {
        id: ticketId || null,
        name: subject || '在线客服',
        sub: '智能助教先答，必要时转人工',
        msgs: []
      },
      chatInput: ''
    })
    if (!ticketId) return
    const that = this
    api.support.messages(ticketId).then(function (list) {
      // 后端按 msg_id 升序返回
      const msgs = (list || []).map(function (m) {
        return {
          from: m.sender_type === 'student' ? 'me' : 'them',
          text: m.content || '',
          time: fmtHM(m.create_time)
        }
      })
      that.setData({ 'chat.msgs': msgs })
      that.scrollBottom()
    }).catch(function () {
      // request 层已 toast，浮层保留
    })
  },

  closeChat() { this.setData({ chatOpen: false }) },
  onChatInput(e) { this.setData({ chatInput: e.detail.value }) },

  // 发送客服消息：已有会话走表 3-25；新咨询首条走表 3-20（自动建单 + 智能应答）
  async sendChat() {
    const v = this.data.chatInput.trim()
    if (!v || this.sending) return
    this.sending = true
    try {
      const chat = this.data.chat
      let res
      if (chat.id) {
        res = await api.support.sendMessage(chat.id, { content: v })
      } else {
        res = await api.support.consult({ content: v, category: 'other' })
        this.setData({ 'chat.id': res.ticketId })
        this.loadTickets()
      }
      const msgs = chat.msgs.concat([
        { from: 'me', text: v, time: nowHM() },
        { from: 'them', text: (res && res.reply) || '', time: nowHM() }
      ])
      this.setData({ 'chat.msgs': msgs, chatInput: '' })
      this.scrollBottom()
      if (res && res.message) wx.showToast({ title: res.message, icon: 'none' })
    } catch (e) {
      // request 层已 toast，保留输入便于重试
    }
    this.sending = false
  },

  // 会话浮层滚到底部（交替改变 scroll-top 触发滚动）
  scrollBottom() {
    this.setData({ chatScrollTop: this.data.chatScrollTop === 99999 ? 99998 : 99999 })
  },

  // 电话客服
  callPhone() {
    wx.makePhoneCall({ phoneNumber: '0851-88886666' })
  },

  // ===== 意见反馈弹层（表 3-20 提交客服咨询，直达产品团队） =====
  openFeedback() {
    this.setData({ feedbackOpen: true })
  },
  closeFeedback() {
    this.setData({ feedbackOpen: false })
  },
  onFbContent(e) { this.setData({ fbContent: e.detail.value }) },
  onFbContact(e) { this.setData({ fbContact: e.detail.value }) },

  // 提交反馈
  async submitFeedback() {
    const { fbContent, fbContact } = this.data
    if (fbContent.trim().length < 5) { wx.showToast({ title: '请描述问题（不少于 5 个字）', icon: 'none' }); return }
    if (fbContact.trim() && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fbContact.trim()) || /^1[3-9]\d{9}$/.test(fbContact.trim()))) {
      wx.showToast({ title: '联系方式格式不正确', icon: 'none' }); return
    }
    try {
      const content = fbContact.trim()
        ? fbContent.trim() + '（联系方式：' + fbContact.trim() + '）'
        : fbContent.trim()
      await api.support.consult({ content, subject: '意见反馈', category: 'other' })
      wx.showToast({ title: '反馈已提交，感谢你的意见', icon: 'success' })
      this.setData({ feedbackOpen: false, fbContent: '', fbContact: '' })
      this.loadTickets()
    } catch (e) {
      // request 层已 toast，弹层保留内容便于重试
    }
  }
})
