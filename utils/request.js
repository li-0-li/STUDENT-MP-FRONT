/**
 * 统一请求封装 —— 与 web/src/api/http.ts 行为一致：
 *   注入 Authorization、解包 {code,message,data}、401 跳登录、统一错误提示。
 */
const { BASE_URL, AUTH_BASE_URL } = require('./config')
const auth = require('./auth')

/* 注册/重置密码/验证码接口由 M-A 独立服务提供（方案A，本地 8081），其余走 itap-server(8080) */
const AUTH_AUX_PREFIXES = ['/v1/auth/register', '/v1/auth/password/reset', '/v1/auth/captcha']

function baseUrlFor(url) {
  return AUTH_AUX_PREFIXES.some(function (p) { return url.indexOf(p) === 0 }) ? AUTH_BASE_URL : BASE_URL
}

function request(method, url, data, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrlFor(url) + url,
      method,
      timeout: 120000, // AI 答疑本地模型推理较慢，放宽到 120s（默认 60s 会掐断长回答）
      data,
      header: Object.assign(
        { 'Content-Type': 'application/json' },
        auth.getToken() ? { Authorization: 'Bearer ' + auth.getToken() } : {},
        options.header || {}
      ),
      success(res) {
        const body = res.data
        if (!body || typeof body.code !== 'number') return resolve(body)

        if (body.code === 0) return resolve(body.data)

        if (body.code === 401) {
          // 已持令牌 → 令牌失效，清缓存跳登录页；未持令牌（如登录时密码错误）→ 仅提示
          if (auth.getToken()) {
            auth.clear()
            wx.reLaunch({ url: '/pages/login/login' })
          } else {
            wx.showToast({ title: body.message || '登录已失效', icon: 'none' })
          }
          return reject(new Error(body.message || '登录已失效'))
        }

        wx.showToast({ title: body.message || '请求失败', icon: 'none' })
        reject(new Error(body.message || '请求失败'))
      },
      fail(err) {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
        reject(err)
      }
    })
  })
}

module.exports = {
  get: (url, params, opt) => request('GET', url, params, opt),
  post: (url, data, opt) => request('POST', url, data, opt),
  put: (url, data, opt) => request('PUT', url, data, opt),
  del: (url, params, opt) => request('DELETE', url, params, opt),
  upload(url, filePath, name = 'file', extra = {}) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: BASE_URL + url,
        filePath,
        name,
        formData: extra,
        header: auth.getToken() ? { Authorization: 'Bearer ' + auth.getToken() } : {},
        success(res) {
          try {
            const body = JSON.parse(res.data)
            if (body.code === 0) resolve(body.data)
            else { wx.showToast({ title: body.message || '上传失败', icon: 'none' }); reject(new Error(body.message)) }
          } catch (e) { reject(e) }
        },
        fail: reject
      })
    })
  }
}