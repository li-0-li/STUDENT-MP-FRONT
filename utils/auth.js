const TOKEN_KEY = 'itap_token'
const ROLE_KEY = 'itap_role'

function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || '' } catch (e) { return '' }
}
function setToken(token) {
  try { wx.setStorageSync(TOKEN_KEY, token) } catch (e) {}
}
function getRole() {
  try { return wx.getStorageSync(ROLE_KEY) || '' } catch (e) { return '' }
}
function setRole(role) {
  try { wx.setStorageSync(ROLE_KEY, role) } catch (e) {}
}
function clear() {
  try { wx.removeStorageSync(TOKEN_KEY); wx.removeStorageSync(ROLE_KEY) } catch (e) {}
}

module.exports = { getToken, setToken, getRole, setRole, clear }