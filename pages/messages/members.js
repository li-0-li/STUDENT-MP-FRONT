// 群成员页（期2）—— 从聊天浮层标题进入，列出该会话全部活跃成员
// 接口：messageApi.members（GET /conversations/{id}/members，非成员 403）
const api = require('../../utils/api')
const FILE_BASE = require('../../utils/config').FILE_BASE_URL

/** 头像 URL 归一（2026-11-12）：http 原样；/api·/files 开头拼静态根；不可读形态返回空 */
function avatarUrl(u) {
  if (!u) return ''
  const s = String(u).trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.indexOf('/api/') === 0 || s.indexOf('/files/') === 0) return FILE_BASE + s
  return ''
}

Page({
  data: {
    loading: true,
    members: [],   // [{userId, displayName, memberRole, studentNo, isMe, isOwner, avatarUrl}]
    profile: null  // 成员资料弹层（2026-11-12：点头像/姓名查看）
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
          className: m.className || '',
          isOwner: m.memberRole === 'owner',
          isMe: meId != null && m.userId === meId,
          // 头像 URL 归一（2026-11-12）：http 原样 / /api·/files 开头拼 FILE_BASE；
          // 其余形态（/profile、裸路径——文件在教师端实例，任何端读不到）置空回退首字
          avatarUrl: avatarUrl(m.avatar),
          avatarShow: !!avatarUrl(m.avatar)
        }
      })
      // 2026-11-13：按姓名拼音首字母排序（需求：群成员列表按姓名首字母顺序）
      members.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh') })
      this.setData({ members, loading: false })
      wx.setNavigationBarTitle({ title: '群成员（' + members.length + '）', fail: function () {} })
    } catch (e) {
      this.setData({ loading: false })
    }
  }
  ,
  // 点成员行 → 成员资料卡（2026-11-12「个人主页」轻量版）
  showProfile(e) {
    const id = Number(e.currentTarget.dataset.id)
    const m = (this.data.members || []).find(function (x) { return x.userId === id })
    if (m) this.setData({ profile: m })
  },

  hideProfile() {
    this.setData({ profile: null })
  }

})
