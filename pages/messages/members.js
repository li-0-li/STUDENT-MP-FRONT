// 群成员页（期2）—— 从聊天浮层标题进入，列出该会话全部活跃成员
// 接口：messageApi.members（GET /conversations/{id}/members，非成员 403）
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    members: []   // [{userId, displayName, memberRole, studentNo, isMe, isOwner}]
  },

  onLoad(options) {
    this.conversationId = Number(options.conversationId || 0)
    wx.setNavigationBarTitle({ title: '群成员', fail: function () {} })
  },

  onShow() { this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const me = await api.user.me().catch(function () { return null })
      const meId = me && me.userId
      const res = await api.message.members(this.conversationId)
      const members = ((res && res.list) || []).map(function (m) {
        const name = m.displayName || ('用户 ' + m.userId)
        return {
          userId: m.userId,
          name: name,
          initial: name.slice(0, 1),
          studentNo: m.studentNo || '',
          isOwner: m.memberRole === 'owner',
          isMe: meId != null && m.userId === meId
        }
      })
      this.setData({ members, loading: false })
      wx.setNavigationBarTitle({ title: '群成员（' + members.length + '）', fail: function () {} })
    } catch (e) {
      this.setData({ loading: false })
    }
  }
})
