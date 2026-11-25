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
    profile: null, // 成员资料弹层（2026-11-12：点头像/姓名查看）
    groupName: '',      // 2026-11-16 群信息头（群头像更换入口）
    groupAvatar: '',
    groupInitial: ''
  },

  onLoad(options) {
    this.conversationId = Number(options.conversationId || 0)
    // 群信息（2026-11-16）：name/avatar 由消息页 openMembers 传入
    // courseId（2026-11-24）：邀请入群用的课程范围（该群所属课程）
    this.courseId = Number(options.courseId || 0)
    const name = decodeURIComponent(options.name || '')
    const avatar = decodeURIComponent(options.avatar || '')
    this.setData({ groupName: name, groupAvatar: avatar, groupInitial: name.slice(0, 1) })
    wx.setNavigationBarTitle({ title: '群成员', fail: function () {} })
  },

  // 邀请同学入群（2026-11-24）：群主与成员均可 → contacts 页 invite 模式选人
  goInvite() {
    if (!this.conversationId || !this.courseId) {
      wx.showToast({ title: '该群暂不支持邀请', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/messages/contacts?mode=invite&conversationId=' + this.conversationId
        + '&courseId=' + this.courseId + '&title=' + encodeURIComponent(this.data.groupName || '')
    })
  },

  onShow() { this.load() },

  // 点群头像 → 选图上传更换（2026-11-16；权限=仅群主，前端预检 + 后端校验双层）
  changeGroupAvatar() {
    const that = this
    if (!this.data.isMeOwner) {
      wx.showToast({ title: '仅群主可以更换群头像', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success(res) {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) {
          wx.showToast({ title: '未取得图片', icon: 'none' })
          return
        }
        wx.showLoading({ title: '上传中…', mask: true })
        api.message.setGroupAvatar(that.conversationId, f.tempFilePath).then(function (r) {
          wx.hideLoading()
          const avatar = (r && r.avatar) || ''
          that.setData({ groupAvatar: avatar, groupAvFail: false })
          wx.showToast({ title: '群头像已更新', icon: 'success' })
        }).catch(function () {
          wx.hideLoading()
        })
      },
      fail(err) {
        // 选图取消/失败此前被静默吞掉（用户观感=点了没反应）
        if (err && err.errMsg && err.errMsg.indexOf('cancel') < 0) {
          wx.showToast({ title: '选图失败：' + (err.errMsg || ''), icon: 'none' })
        }
      }
    })
  },

  // 群头像加载失败 → 首字兜底
  onGroupAvError() {
    this.setData({ groupAvFail: true })
  },

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
      // 2026-11-16：群头像更换权限=仅群主（控制「改」角标显隐）
      const iAmOwner = members.some(function (m) { return m.isMe && m.isOwner })
      this.setData({ members, isMeOwner: iAmOwner, loading: false })
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
  ,
  // 头像加载失败兜底（2026-11-16）：binderror 切默认头像
  onAvError(e) {
    this.setData({ ['members[' + e.currentTarget.dataset.idx + '].avFail']: true })
  },
  onCardAvError() {
    this.setData({ 'profile.avFail': true })
  },

  // ===== 群主管理（2026-11-18：踢人 / 解散，权限=仅群主，前端预检 + 后端校验双层） =====

  // 资料卡内「移出群聊」：群主对普通成员可见；确认后踢出并刷新列表
  kickMember() {
    const that = this
    const p = this.data.profile
    if (!p || !this.data.isMeOwner || p.isMe || p.isOwner) return
    wx.showModal({
      title: '移出成员',
      content: '确定将「' + p.name + '」移出群聊？移出后其将不再收到本群消息。',
      confirmColor: '#dc2626',
      success(res) {
        if (!res.confirm) return
        api.message.kick(that.conversationId, p.userId).then(function (r) {
          wx.showToast({ title: (r && r.message) || '已移出群聊', icon: 'success' })
          that.setData({ profile: null })
          that.load()
        }).catch(function () {})
      }
    })
  },

  // 页面底部「解散群聊」（仅群主可见）：二次确认（不可逆）。解散后所有人不可再发言，
  // 但群保留在所有人会话列表（历史消息可查看）；成功后返回消息页（列表由消息页刷新）
  dissolveGroup() {
    const that = this
    if (!this.data.isMeOwner) return
    wx.showModal({
      title: '解散群聊',
      content: '解散后所有成员将被移出且不可恢复。确定解散「' + (this.data.groupName || '本群') + '」？',
      confirmColor: '#dc2626',
      success(res) {
        if (!res.confirm) return
        api.message.dissolve(that.conversationId).then(function () {
          wx.showToast({ title: '群聊已解散', icon: 'success' })
          setTimeout(function () { wx.navigateBack({ fail: function () {} }) }, 900)
        }).catch(function () {})
      }
    })
  }

})
