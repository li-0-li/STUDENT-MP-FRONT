// 个人信息页（2026-11-11 新增）：点击「我的」页头像卡片进入
// 口径：仅头像可改（POST /users/me/avatar 已有）；
//   姓名/性别/学校/学院/专业/班级/学号均由管理端维护，本页只读展示。
const api = require('../../utils/api')
const { FILE_BASE_URL } = require('../../utils/config')

/** 头像地址：相对路径拼静态根 */
function avatarUrl(u) {
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : FILE_BASE_URL + u
}

/** sys_user.sex：0 男 / 1 女 / 2 未知 */
function sexText(sex) {
  if (sex === '0' || sex === 0) return '男'
  if (sex === '1' || sex === 1) return '女'
  return '未设置'
}

Page({
  data: {
    loading: true,
    user: {
      name: '',
      sexText: '未设置',
      schoolName: '',
      collegeName: '',
      majorName: '',
      className: '',
      userNo: ''
    },
    avatarSrc: ''
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const u = await api.user.me()
      this.setData({
        loading: false,
        user: {
          name: u.nickName || u.username || '',
          sexText: sexText(u.sex),
          schoolName: u.schoolName || '未设置',
          collegeName: u.collegeName || '未设置',
          majorName: u.majorName || '未设置',
          className: u.className || '未设置',
          userNo: u.userNo || '未设置'
        },
        avatarSrc: avatarUrl(u.avatar)
      })
    } catch (e) {
      // request 层已 toast
      this.setData({ loading: false })
    }
  },

  /** 换头像：选图 → 上传 → 刷新 */
  changeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!filePath) return
        wx.showLoading({ title: '上传中…', mask: true })
        api.user.uploadAvatar(filePath).then(() => {
          wx.hideLoading()
          wx.showToast({ title: '头像已更新', icon: 'success' })
          this.setData({ avatarSrc: filePath + '?t=' + Date.now() })
        }).catch(() => {
          wx.hideLoading()
          // request 层已 toast
        })
      }
    })
  }
})
