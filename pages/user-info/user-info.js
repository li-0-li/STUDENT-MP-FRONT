// 个人信息页（2026-11-11 新增）：点击「我的」页头像卡片进入
// 口径：头像可改（POST /users/me/avatar）；2026-11-26 手机号可改（PUT /users/me/profile，
//   后端已有唯一性校验）；姓名/性别/学校/学院/专业/班级/学号由管理端维护，只读展示。
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
      userNo: '',
      phone: ''
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
          userNo: u.userNo || '未设置',
          phone: u.phone || ''
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
  },

  /** 修改手机号（2026-11-26）：输入新号 → 格式校验 → PUT /users/me/profile → 刷新。
   *  与原换绑页口径一致：无短信验证（后端无 change_phone 短信场景），唯一性由后端校验。 */
  changePhone() {
    const that = this
    wx.showModal({
      title: '修改手机号',
      editable: true,
      placeholderText: '请输入 11 位手机号',
      content: this.data.user.phone || '',
      success(res) {
        if (!res.confirm) return
        const phone = (res.content || '').trim()
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          wx.showToast({ title: '手机号格式不正确', icon: 'none' })
          return
        }
        if (phone === that.data.user.phone) {
          wx.showToast({ title: '新号码与当前一致', icon: 'none' })
          return
        }
        wx.showLoading({ title: '保存中…', mask: true })
        // 后端 PUT /users/me/profile 接收 SysUser 实体，字段名为 phonenumber（与 /users/me 返回的 phone 不同名）
        api.user.updateProfile({ phonenumber: phone }).then(() => {
          wx.hideLoading()
          that.setData({ 'user.phone': phone })
          wx.showToast({ title: '手机号已更新', icon: 'success' })
        }).catch(() => {
          wx.hideLoading()
          // request 层已 toast（含手机号被占用等后端校验失败）
        })
      }
    })
  }
})
