// 聊天记录搜索（期3修订 独立页面）
// 数据：GET /api/v1/conversations/{id}/records?msgType=&senderId=&keyword=（三条件全可空）
// 群聊：可按人员 + 类型 + 关键词组合筛选；私聊：类型 + 关键词
const api = require('../../utils/api')
const FILE_BASE = require('../../utils/config').FILE_BASE_URL

function absUrl(u) {
  return u ? (String(u).indexOf('http') === 0 ? u : FILE_BASE + u) : ''
}

function fmtBytes(n) {
  n = Number(n) || 0
  if (n <= 0) return ''
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB'
  return (n / 1024 / 1024).toFixed(1) + 'MB'
}

// send_time → MM-DD HH:mm
function fmtTime(iso) {
  return iso ? String(iso).replace('T', ' ').slice(5, 16) : ''
}

// 类型筛选项（私聊/群聊通用）
const TYPE_PILLS = [
  { k: '', t: '全部' },
  { k: 'text', t: '文本' },
  { k: 'image', t: '图片' },
  { k: 'video', t: '视频' },
  { k: 'file', t: '文件' }
]

Page({
  data: {
    conversationId: null,
    convType: '',        // group=群聊（显示人员筛选）/ direct=私聊
    keyword: '',
    typePills: TYPE_PILLS,
    typeIdx: 0,          // 选中的类型 pill 下标（''=全部）
    members: [],         // [{userId, name, initial}] 仅群聊拉取，首项为「全部成员」
    memberIdx: 0,
    loading: false,
    searched: false,
    results: []         // [{id, type, text, url, name, size, sender, time}]
  },

  onLoad(options) {
    this.setData({
      conversationId: Number(options.conversationId),
      convType: options.type || '',
      members: [{ userId: null, name: '全部成员', initial: '全' }]
    })
    if (options.name) {
      wx.setNavigationBarTitle({ title: '聊天记录 · ' + decodeURIComponent(options.name) })
    }
    if (options.type === 'group') this.loadMembers()
    this.doSearch()   // 进入即展示最近记录（全空 = 最近 100 条）
  },

  // 群聊拉成员列表做人员筛选（api.message.members 已含群主置顶排序）
  async loadMembers() {
    try {
      const res = await api.message.members(this.data.conversationId)
      const pills = [{ userId: null, name: '全部成员', initial: '全' }]
        .concat(((res && res.list) || []).map(function (m) {
          const name = m.displayName || ('用户 ' + m.userId)
          return { userId: m.userId, name: name, initial: name.slice(0, 1) }
        }))
      this.setData({ members: pills })
    } catch (e) { /* request 层已 toast */ }
  },

  onKeyInput(e) { this.setData({ keyword: e.detail.value }) },

  tapTypePill(e) { this.setData({ typeIdx: Number(e.currentTarget.dataset.idx) }); this.doSearch() },
  tapMember(e) { this.setData({ memberIdx: Number(e.currentTarget.dataset.idx) }); this.doSearch() },

  async doSearch() {
    const d = this.data
    const params = {
      msgType: d.typePills[d.typeIdx].k,
      senderId: (d.convType === 'group' && d.members[d.memberIdx] && d.members[d.memberIdx].userId) || '',
      keyword: d.keyword
    }
    this.setData({ loading: true })
    try {
      const list = await api.message.records(d.conversationId, params)
      const results = (list || []).map(function (m) {
        return {
          id: m.message_id,
          type: m.msg_type || 'text',
          text: m.content || '',
          url: absUrl(m.file_url),
          name: m.file_name || '',
          size: fmtBytes(m.file_size),
          sender: m.sender_name || '',
          time: fmtTime(m.send_time)
        }
      })
      this.setData({ results, searched: true })
    } catch (e) { /* request 层已 toast */ }
    this.setData({ loading: false })
  },

  // 结果项点按：按类型分发（图片→全屏预览 / 视频→previewMedia / 文件→下载 / 文本→弹详情）
  tapResult(e) {
    const m = this.data.results[Number(e.currentTarget.dataset.idx)]
    if (!m) return
    if (m.type === 'image') {
      const urls = this.data.results.filter(function (r) { return r.type === 'image' && r.url })
        .map(function (r) { return r.url })
      wx.previewImage({ current: m.url, urls: urls.length ? urls : [m.url] })
    } else if (m.type === 'video') {
      if (wx.previewMedia) {
        wx.previewMedia({ sources: [{ url: m.url, type: 'video' }] })
      } else {
        wx.showToast({ title: '当前基础库版本过低，无法预览视频', icon: 'none' })
      }
    } else if (m.type === 'file') {
      wx.showLoading({ title: '下载中…', mask: true })
      wx.downloadFile({
        url: m.url,
        success(res) {
          wx.hideLoading()
          wx.openDocument({ filePath: res.tempFilePath, showMenu: true, fail() { wx.showToast({ title: '该文件类型暂不支持预览', icon: 'none' }) } })
        },
        fail() { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }) }
      })
    } else {
      wx.showModal({ title: (m.sender || '我') + ' · ' + m.time, content: m.text, showCancel: false })
    }
  }
})
