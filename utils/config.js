/** 后端地址。开发时在微信开发者工具里勾选「不校验合法域名」。 */
const BASE_URL = 'http://127.0.0.1:8080/api'

/** M-A 认证服务地址：itap-merged 已把 auth（登录/注册/验证码/重置密码）并入 8080，
 *  不再走独立的 8081；若日后拆回独立 M-A 服务，改这里即可（request.js 按前缀自动路由）。 */
const AUTH_BASE_URL = 'http://127.0.0.1:8080/api'

/** 静态文件根地址（资源下载/预览用）：资源 fileUrl 形如 /files/res/xxx，须拼此根而非 /api */
const FILE_BASE_URL = BASE_URL.replace(/\/api$/, '')

module.exports = { BASE_URL, FILE_BASE_URL, AUTH_BASE_URL }
