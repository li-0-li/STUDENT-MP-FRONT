// AI 答疑 —— 原型：ui-prototype/mp/app-ai.html
// 接入（真实接口）：
//   aiApi.ask      —— 表 3-9 课程 AI 答疑（POST /api/v1/qa/ask，本地大模型不可用时后端自动降级为规则回答）
//   aiApi.feedback —— 表 3-10 答疑反馈（useful 有用 / useless 无用）
//   courseApi.listMine —— 表 3-1 我学的课（答疑检索范围按课程知识库切换）
//   api.user.me    —— 表 2-14 当前用户（会话头像取昵称首字）
// 说明：提问耗时较长（最长 60s），发送后先上屏用户消息 + 「思考中」占位，回答到达后替换；
//       超出每日配额时后端返回 429（request 层已 toast，页面追加失败气泡提示）。
const api = require('../../utils/api')

// 通用快捷提问（进入页面即可一键发送）
const QUICK_QUESTIONS = [
  '本章的重点知识点是什么？',
  '帮我总结这一章的内容',
  '给我出几道练习题',
  '这个知识点有哪些典型例题？'
]

Page({
  data: {
    courseIds: [],   // 可选课程（知识库检索范围）
    kbNames: [],
    kbIndex: 0,       // 当前课程下标
    kbName: '加载中…',
    quick: QUICK_QUESTIONS,
    messages: [],     // 消息列表 {role:'user'|'ai', text, refs, degrade, score, scorePercent, qaId, feedback, typing, error}
    inputValue: '',
    scrollIntoView: '', // 滚动定位
    avatarChar: '我'   // 当前用户昵称首字
  },

  onLoad() {
    this.sessionId = 'mp-' + Date.now() // 同一次连续追问共用
    this.asking = false                 // 思考中防重复发送
    this.loadCourses()
    api.user.me()
      .then((me) => {
        const n = (me && me.name) || ''
        if (n) this.setData({ avatarChar: n.slice(0, 1) })
      })
      .catch(() => {})
  },

  // 加载「我学的课」作为知识库范围
  async loadCourses() {
    try {
      const data = await api.course.listMine({ page: 1, pageSize: 50 })
      const list = (data && data.list) || []
      if (!list.length) {
        this.setData({ kbName: '未选课', messages: [] })
        return
      }
      this.setData({
        courseIds: list.map((c) => c.courseId),
        kbNames: list.map((c) => c.courseName),
        kbIndex: 0,
        kbName: list[0].courseName
      })
    } catch (e) {
      // request 层已 toast
      this.setData({ kbName: '课程加载失败' })
      return
    }
    this.initSession()
  },

  // 初始化会话（欢迎语，无演示数据）
  initSession() {
    this.setData({
      messages: [
        { role: 'ai', text: '你好，我是课程 AI 助教，回答基于本课程资源生成。可以直接输入问题，或点击下方快捷提问。' }
      ],
      scrollIntoView: ''
    })
    this.scrollToBottom()
  },

  // 切换课程知识库（picker）
  onKbChange(e) {
    const idx = Number(e.detail.value)
    if (isNaN(idx) || !this.data.courseIds[idx]) return
    this.setData({ kbIndex: idx, kbName: this.data.kbNames[idx] })
    this.initSession()
  },

  // 历史会话列表入口：带当前课程跳转历史会话页（2026-10-29 已实现）
  goHistory() {
    const courseId = this.data.courseIds[this.data.kbIndex]
    if (!courseId) {
      wx.showToast({ title: '请先选择课程', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/ai-history/ai-history?courseId=' + courseId
        + '&courseName=' + encodeURIComponent(this.data.kbName || '')
    })
  },

  // 清空当前会话：本地消息 + 服务端该 session_id 的问答记录一并删除（2026-10-29），
  // 之后换新 sessionId，后续提问落库到全新会话，不会在历史会话里复活
  clearSession() {
    wx.showModal({
      title: '清空会话',
      content: '确定清空当前会话的全部消息吗？（历史会话中的该条记录也会删除）',
      confirmColor: '#0d9488',
      success: (res) => {
        if (!res.confirm) return
        const courseId = this.data.courseIds[this.data.kbIndex]
        const oldSessionId = this.sessionId
        this.sessionId = 'mp-' + Date.now() // 先换新会话，删除失败也不影响继续提问
        this.initSession()
        if (courseId && oldSessionId) {
          api.ai.qaSessionDelete(oldSessionId, courseId).catch(() => {
            // request 层已 toast；本地已清空，仅历史记录残留
          })
        }
      }
    })
  },

  // 输入框内容绑定
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  // 点击快捷问题，直接作为提问发送
  onTapQuick(e) {
    this.ask(e.currentTarget.dataset.q)
  },

  // 发送（输入框确认或点击发送按钮）
  onConfirm() {
    this.ask(this.data.inputValue)
  },
  onSend() {
    this.ask(this.data.inputValue)
  },

  // 发送一条提问：push 用户消息 →「思考中」占位 → 真实接口回答后替换
  async ask(text) {
    const q = (text || '').trim()
    if (!q) return
    if (this.asking) {
      wx.showToast({ title: 'AI 正在思考，请稍候…', icon: 'none' })
      return
    }
    const courseId = this.data.courseIds[this.data.kbIndex]
    if (!courseId) {
      wx.showToast({ title: '请先选择课程', icon: 'none' })
      return
    }

    const messages = this.data.messages.concat([{ role: 'user', text: q }])
    messages.push({ role: 'ai', text: '', typing: true })
    this.setData({ messages, inputValue: '' })
    this.scrollToBottom()

    this.asking = true
    try {
      const res = await api.ai.ask({ courseId, question: q, sessionId: this.sessionId })
      const citations = (res && res.citations) || []
      const score = Number(res && res.score) || 0
      // 引用来源拼成一段文案（wxml 单文本展示）
      const refs = citations
        .map((c) => '《' + (c.sourceFile || '课程资料') + '》' + (c.locator ? ' · ' + c.locator : ''))
        .join('；')
      this.replaceTyping({
        role: 'ai',
        text: (res && res.answer) || '',
        refs,
        score,
        scorePercent: Math.round(score * 100),
        // 最高匹配度低于 60%（或未命中知识库）→ 降级提示样式
        degrade: !citations.length || score < 0.6,
        qaId: res ? res.qaId : null
      })
    } catch (e) {
      // request 层已 toast（含 429 每日配额超限等），这里保留失败气泡便于回看
      this.replaceTyping({
        role: 'ai',
        error: true,
        text: '回答获取失败：' + ((e && e.message) || '网络异常') + '。请稍后重试。'
      })
    } finally {
      this.asking = false
    }
  },

  // 弹出「思考中」占位，替换为真实回复/失败提示
  replaceTyping(reply) {
    const list = this.data.messages.slice(0, -1).concat([reply])
    this.setData({ messages: list })
    this.scrollToBottom()
  },

  // 对 AI 回答点赞 / 点踩（表 3-10）
  onFeedback(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const type = e.currentTarget.dataset.type // useful / useless
    const msg = this.data.messages[idx]
    if (!msg || !msg.qaId || msg.feedback) return
    api.ai.feedback(msg.qaId, { feedback: type })
      .then(() => {
        this.setData({ ['messages[' + idx + '].feedback']: type })
        wx.showToast({ title: '感谢你的反馈', icon: 'none' })
      })
      .catch(() => {
        // request 层已 toast
      })
  },

  // 滚动到消息列表底部
  scrollToBottom() {
    const id = 'msg-' + (this.data.messages.length - 1)
    // 等渲染完成后再定位
    setTimeout(() => this.setData({ scrollIntoView: id }), 50)
  }
})
