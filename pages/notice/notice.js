// 系统通知 —— 原型：ui-prototype/mp/app-notice.html
// 接入：messageApi.notifications（表 2-13 站内通知，biz_type=ann/remind/maint）
//   / markRead（表 2-17 已读标记，点击单条标记）

const api = require('../../utils/api')

// 业务类型 → 图标/样式（公告 📢 / 学习提醒 ⏰ / 系统 🔧，与原型一致）
const TYPE_META = {
  ann: { icon: '📢', iconCls: '' },
  remind: { icon: '⏰', iconCls: 'warning' },
  maint: { icon: '🔧', iconCls: 'sys' }
}

// 分类筛选标签（原型 systab，key 与后端 biz_type 对应）
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'ann', label: '平台公告' },
  { key: 'remind', label: '学习提醒' },
  { key: 'maint', label: '系统' }
]

// 时间解析（后端形如 2026-09-29T09:00:00，'-' 转 '/' 兼容 iOS）
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

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    loading: true,
    notices: []   // 当前展示列表（按 activeTab 过滤后）
  },

  onShow() { this.loadNotices() },

  async loadNotices() {
    this.setData({ loading: true })
    try {
      const list = await api.message.notifications()
      // 后端按「未读在前、时间倒序」返回
      this.allNotices = (list || []).map(function (n) {
        return Object.assign({
          id: n.notice_id,
          type: n.biz_type || 'ann',
          title: n.title || '通知',
          time: fmtListTime(n.create_time),
          unread: !n.is_read,
          content: n.content || ''
        }, TYPE_META[n.biz_type] || TYPE_META.ann)
      })
      this.applyFilter()
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  // 按当前 tab 过滤展示
  applyFilter() {
    const key = this.data.activeTab
    const notices = key === 'all' ? this.allNotices : this.allNotices.filter((n) => n.type === key)
    this.setData({ notices, loading: false })
  },

  // 切换分类
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key })
    this.applyFilter()
  },

  // 点击通知：弹出详情 + 标记已读（表 2-17，单条）
  openNotice(e) {
    const id = e.currentTarget.dataset.id
    const idx = this.data.notices.findIndex((n) => n.id === id)
    if (idx < 0) return
    const n = this.data.notices[idx]
    wx.showModal({
      title: n.title || '通知',
      content: ((n.content || '') + (n.time ? '\n\n' + n.time : '')) || '（无正文）',
      showCancel: false
    })
    if (n.unread) {
      this.setData({ ['notices[' + idx + '].unread']: false })
      const all = this.allNotices.find((a) => a.id === id)
      if (all) all.unread = false
      api.message.markRead({ noticeIds: [id] }).catch(() => {})
    }
  },

  // 下拉刷新（重新拉取通知列表）
  onPullDownRefresh() {
    this.loadNotices().finally(() => wx.stopPullDownRefresh())
  }
})
