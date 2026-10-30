// AI 答疑 · 历史会话（缺口补位功能，2026-10-29）
// 接入：
//   api.ai.qaSessions        —— GET /api/v1/qa/sessions?courseId=（按 session_id 聚合，最近在前）
//   api.ai.qaSessionMessages —— GET /api/v1/qa/sessions/{sessionId}/messages?courseId=（正序问答对）
//   api.ai.qaSessionDelete   —— DELETE /api/v1/qa/sessions/{sessionId}?courseId=（删除整条会话）
// 交互：会话列表 → 点击某条会话展开该会话的问答明细（本页内切换，返回键回到列表）。
// 注意：接口出参为下划线风格（first_question / qa_count / last_time / hit_knowledge）。
const api = require('../../utils/api')

/** ISO 时间 → 「MM-DD HH:mm」 */
function fmtTime(s) {
  return s ? String(s).replace('T', ' ').slice(5, 16) : ''
}

Page({
  data: {
    courseName: '',
    sessions: [],      // [{sessionId, firstQuestion, qaCount, lastTime}]
    loading: true,
    // 明细视图状态（view=detail 时渲染）
    view: 'list',      // list | detail
    detailTitle: '',
    detailSessionId: '',
    messages: []       // [{question, answer, refs, hit, time}]
  },

  onLoad(options) {
    const o = options || {}
    this.courseId = Number(o.courseId || 0) || null
    const courseName = o.courseName ? decodeURIComponent(o.courseName) : ''
    this.setData({ courseName })
    if (courseName) {
      wx.setNavigationBarTitle({ title: courseName + ' · 历史会话' })
    }
    this.loadSessions()
  },

  // 会话列表
  async loadSessions() {
    if (!this.courseId) {
      this.setData({ loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const rows = await api.ai.qaSessions(this.courseId)
      const list = (Array.isArray(rows) ? rows : []).map((it) => ({
        sessionId: String(it.session_id || ''),
        firstQuestion: it.first_question || '（无标题）',
        qaCount: it.qa_count || 0,
        lastTime: fmtTime(it.last_time)
      }))
      this.setData({ sessions: list, loading: false })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // 打开某条会话的问答明细
  async openSession(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    // 明细视图「删除该会话」按钮用（wxml 需从 data 取 sessionId）
    this.setData({ view: 'detail', detailTitle: '', messages: [], loading: true, detailSessionId: sessionId })
    try {
      const rows = await api.ai.qaSessionMessages(sessionId, this.courseId)
      const msgs = (Array.isArray(rows) ? rows : []).map((it) => {
        // citations 为后端落库的 JSON 字符串（可能为 "[]" 或解析失败），拼成一段文案
        let refs = ''
        try {
          const arr = JSON.parse(it.citations || '[]')
          refs = (Array.isArray(arr) ? arr : [])
            .map((c) => '《' + (c.sourceFile || '课程资料') + '》' + (c.locator ? ' · ' + c.locator : ''))
            .join('；')
        } catch (err) { /* 旧记录格式不一致时忽略引用 */ }
        return {
          question: it.question || '',
          answer: it.answer || '',
          refs,
          hit: it.hit_knowledge === 1 || it.hit_knowledge === true,
          time: fmtTime(it.create_time)
        }
      })
      this.setData({
        detailTitle: msgs.length ? msgs[0].question : '（空会话）',
        messages: msgs,
        loading: false
      })
    } catch (e) {
      // request 层已 toast（含「会话不存在」404）
      this.setData({ loading: false })
    }
  },

  // 删除一条会话（列表卡片 / 明细视图均可触发；catchtap 防止冒泡到 openSession）
  deleteSession(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    wx.showModal({
      title: '删除会话',
      content: '删除后该会话的全部问答记录不可恢复，确定删除吗？',
      confirmColor: '#e11d48',
      success: (res) => {
        if (!res.confirm) return
        api.ai.qaSessionDelete(sessionId, this.courseId)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            // 若正在看这条会话的明细，先回列表再刷新
            if (this.data.view === 'detail') this.backToList()
            this.loadSessions()
          })
          .catch(() => {
            // request 层已 toast
          })
      }
    })
  },

  // 明细 → 返回列表（自定义返回按钮；系统返回键直接退出页面也可）
  backToList() {
    this.setData({ view: 'list', messages: [], detailTitle: '', detailSessionId: '' })
  }
})
