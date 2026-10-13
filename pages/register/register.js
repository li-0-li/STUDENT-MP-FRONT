// 注册账号 —— 原型：ui-prototype/mp/register.html（分步表单：角色 → 资料 → 密码/院系 → 验证码校验）
// 接入 M-A 认证服务（8081，request.js 自动路由）：POST /api/v1/auth/captcha/send + /register
//   M-A 契约仅支持学生自助注册（默认绑定 student 角色）；姓名/院系等资料暂不入库（后端 DTO 无对应字段）
const api = require('../../utils/api')

Page({
  data: {
    step: 1,          // 1 角色 2 资料 3 密码/院系 4 验证码校验
    role: 'student',  // teacher / student（默认学生；教师暂不支持自助注册）
    // 第 2 步：资料
    userNo: '',       // 学号 / 工号
    name: '',         // 姓名
    phone: '',        // 手机号
    mail: '',         // 邮箱（选填）
    // 第 3 步：密码 / 院系
    password: '',
    password2: '',
    dept: '',         // 所属院系
    ext: '',          // 职称（教师）/ 专业班级（学生）
    departments: ['计算机科学与技术学院', '软件学院', '数学与统计学院', '外国语学院'],
    extOptions: [],   // 随角色切换
    // 第 4 步：验证码
    smsCode: '',
    counting: false, countdown: 0,
    agree: true,
    submitting: false
  },

  onLoad() {
    this.applyRole('student')
  },

  // 角色 / 身份相关下拉选项（与原型一致）
  applyRole(role) {
    const extOptions = role === 'teacher'
      ? ['教授', '副教授', '讲师', '助教']
      : ['计算机科学与技术 2301', '软件工程 2201', '人工智能 2401', '数据科学 2302']
    this.setData({ role, extOptions, ext: '' })
  },

  pickRole(e) { this.applyRole(e.currentTarget.dataset.role) },

  // ===== 输入 =====
  onNo(e) { this.setData({ userNo: e.detail.value }) },
  onName(e) { this.setData({ name: e.detail.value }) },
  onPhone(e) { this.setData({ phone: e.detail.value }) },
  onMail(e) { this.setData({ mail: e.detail.value }) },
  onPwd(e) { this.setData({ password: e.detail.value }) },
  onPwd2(e) { this.setData({ password2: e.detail.value }) },
  onDept(e) { this.setData({ dept: this.data.departments[e.detail.value] }) },
  onExt(e) { this.setData({ ext: this.data.extOptions[e.detail.value] }) },
  onSmsCode(e) { this.setData({ smsCode: e.detail.value }) },
  toggleAgree() { this.setData({ agree: !this.data.agree }) },

  goLogin() { wx.navigateBack() },

  // ===== 步骤校验与切换 =====
  nextStep() {
    const { step, role, userNo, name, phone, mail, password, password2, dept } = this.data
    if (step === 1) {
      if (role === 'teacher') { wx.showToast({ title: '教师账号由管理员开通，暂不支持自助注册', icon: 'none' }); return }
      this.setData({ step: 2 }); return
    }
    if (step === 2) {
      if (!userNo.trim() || !name.trim()) { wx.showToast({ title: '请填写' + (role === 'teacher' ? '工号' : '学号') + '与姓名', icon: 'none' }); return }
      if (!/^1[3-9]\d{9}$/.test(phone.trim())) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }
      if (mail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim())) { wx.showToast({ title: '邮箱格式不正确', icon: 'none' }); return }
      this.setData({ step: 3 }); return
    }
    if (step === 3) {
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        wx.showToast({ title: '密码需 8 位以上，且包含字母与数字', icon: 'none' }); return
      }
      if (password !== password2) { wx.showToast({ title: '两次输入的密码不一致', icon: 'none' }); return }
      if (!dept) { wx.showToast({ title: '请选择所属院系', icon: 'none' }); return }
      const p = phone.trim()
      this.setData({ step: 4, phoneMask: p.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }); return
    }
  },
  prevStep() { if (this.data.step > 1) this.setData({ step: this.data.step - 1 }) },

  // ===== 第 4 步：短信验证码（M-A /auth/captcha/send，scene=register）=====
  async sendCode() {
    const { phone, counting } = this.data
    if (counting) return
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' }); return }
    try {
      const res = await api.auth.sendCaptcha({ target: phone.trim(), channel: 'phone', scene: 'register' })
      // 联调期后端开启回显（zhike.verify.return-code），直接提示验证码便于本地测试
      const hint = res && res.code ? '（联调回显：' + res.code + '）' : ''
      wx.showToast({ title: '验证码已发送' + hint, icon: 'none' })
      this.setData({ counting: true, countdown: 60 })
      this._timer = setInterval(() => {
        const n = this.data.countdown - 1
        if (n <= 0) {
          clearInterval(this._timer)
          this.setData({ counting: false, countdown: 0 })
        } else {
          this.setData({ countdown: n })
        }
      }, 1000)
    } catch (e) { /* request.js 已 toast */ }
  },
  onUnload() { if (this._timer) clearInterval(this._timer) },

  // ===== 提交注册（M-A /auth/register：验证码校验 + 建号 + 默认学生角色）=====
  async doRegister() {
    const { role, userNo, phone, mail, password, smsCode, agree, submitting } = this.data
    if (submitting) return
    if (role === 'teacher') { wx.showToast({ title: '教师账号由管理员开通，暂不支持自助注册', icon: 'none' }); return }
    if (!smsCode.trim()) { wx.showToast({ title: '请输入短信验证码', icon: 'none' }); return }
    if (!agree) { wx.showToast({ title: '请先同意服务协议', icon: 'none' }); return }

    this.setData({ submitting: true })
    try {
      await api.auth.register({
        username: userNo.trim(),
        password: password,
        phone: phone.trim(),
        email: mail.trim() || undefined,
        channel: 'phone',
        code: smsCode.trim(),
        schoolId: 0
      })
      wx.showToast({ title: '注册成功，请登录', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      this.setData({ submitting: false })
    }
  }
})
