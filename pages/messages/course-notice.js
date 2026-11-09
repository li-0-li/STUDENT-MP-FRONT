// 课程通告子页 —— 从「消息通知」页课程文件夹点进（onLoad 传 groupId + title）
// 展示该课程（或「系统通知」组）下的全部公告；分组判定与 messages 页 noticeGroupKey 完全一致。
// 接入：messageApi.notifications（表 2-13）/ markRead（表 2-17）/ remove（长按删除，软删仅本人）
const api = require('../../utils/api')

// pad / 时间格式化：与 messages 页同口径（今天 HH:mm，昨天 MM-DD…）
function pad(n) { return ('0' + n).slice(-2) }
function fmtListTime(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).replace('T', ' ').replace(/-/g, '/'))
  const now = new Date()
  const sameDate = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDate(d, now)) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (sameDate(d, yesterday)) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

// ★ 与 messages 页 noticeGroupKey 同一套分组判定：
//   biz_type 为课程类（course/course_announce/announce）且带 biz_id → 课程组（key=biz_id），
//   其余归「系统」组（key=0）。两处必须保持一致，改一处记得同步另一处。
const COURSE_BIZ = ['course', 'course_announce', 'announce']
function noticeGroupKey(n) {
  return (COURSE_BIZ.indexOf(n.biz_type) >= 0 && n.biz_id) ? Number(n.biz_id) : 0
}

Page({
  data: {
    loading: true,
    items: []
  },

  onLoad(options) {
    this.groupId = Number(options.groupId || 0)
    const title = decodeURIComponent(options.title || '通告')
    wx.setNavigationBarTitle({ title: title + ' · 通告', fail: function () {} })
  },

  onShow() { this.load() },

  // 拉全量通知后按分组 key 过滤出本组（两页同源同口径）
  async load() {
    this.setData({ loading: true })
    try {
      const list = await api.message.notifications()
      const gid = this.groupId
      const items = (list || [])
        .filter(function (n) { return noticeGroupKey(n) === gid })
        .map(function (n) {
          return {
            id: n.notice_id,
            title: n.title || '通知',
            text: n.content || '',
            time: fmtListTime(n.create_time),
            unread: !n.is_read
          }
        })
      this.setData({ items })
    } catch (e) {
      // request 层已 toast
    }
    this.setData({ loading: false })
  },

  // 点击查看详情；未读则标记已读（表 2-17），返回上一页时红点自动刷新
  openNotice(e) {
    const idx = e.currentTarget.dataset.idx
    const n = this.data.items[idx]
    if (!n) return
    wx.showModal({
      title: n.title,
      content: ((n.text || '') + (n.time ? '\n\n' + n.time : '')) || '（无正文）',
      showCancel: false
    })
    if (n.unread) {
      this.setData({ ['items[' + idx + '].unread']: false })
      api.message.markRead({ noticeIds: [n.id] }).catch(function () {})
    }
  },

  // 长按删除（软删，仅本人）；删完返回上一页文件夹列表自动刷新
  deleteNotice(e) {
    const idx = e.currentTarget.dataset.idx
    const n = this.data.items[idx]
    if (!n) return
    const that = this
    wx.showModal({
      title: '删除通知',
      content: '确定删除「' + n.title + '」吗？',
      success(res) {
        if (res.confirm) that.doDelete(n.id)
      }
    })
  },

  async doDelete(id) {
    try {
      await api.message.remove({ targetType: 'notice', targetIds: [id] })
      this.setData({ items: this.data.items.filter(function (x) { return x.id !== id }) })
    } catch (e) {
      // request 层已 toast
    }
  }
})
