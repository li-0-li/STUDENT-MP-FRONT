// 群文件（期3 群文件夹）—— 会话内全部图片/文件消息汇总
// 数据：GET /api/v1/conversations/{id}/files（msg_type in image/file，不含已删/已撤回）
// 展示：图片九宫格（点按全屏预览）+ 文件列表（点按下载预览）
const api = require('../../utils/api')
const FILE_BASE = require('../../utils/config').FILE_BASE_URL

function absUrl(u) {
  return u ? (String(u).indexOf('http') === 0 ? u : FILE_BASE + u) : ''
}

function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB'
  return (n / 1024 / 1024).toFixed(1) + 'MB'
}

// send_time（形如 2026-11-06T10:00:00）→ 2026-11-06
function fmtDate(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 16) : ''
}

Page({
  data: {
    conversationId: null,
    loading: true,
    files: []    // [{id, url, name, size, sender, time}]（期3修订：只放文件，图片/视频去聊天记录页看）
  },

  onLoad(options) {
    const id = Number(options.conversationId)
    this.setData({ conversationId: id })
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const list = await api.message.files(this.data.conversationId)
      const files = []
      ;(list || []).forEach(function (m) {
        if (m.msg_type !== 'file') return  // 图片/视频不入群文件页
        files.push({
          id: m.message_id,
          url: absUrl(m.file_url),
          name: m.file_name || '未命名文件',
          size: fmtBytes(m.file_size),
          sender: m.sender_name || '',
          time: fmtDate(m.send_time)
        })
      })
      this.setData({ files })
    } catch (e) { /* request 层已 toast */ }
    this.setData({ loading: false })
  },

  // 文件点按 → 下载后文档预览
  openFile(e) {
    const url = e.currentTarget.dataset.url
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
  }
})
