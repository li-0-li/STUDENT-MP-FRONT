// 1. 获取当前运行环境
const systemInfo = wx.getSystemInfoSync();
// 如果 platform 是 'devtools'，说明在电脑的微信开发者工具里运行；否则就是真机（iOS/Android）
const isDevTools = systemInfo.platform === 'devtools';

// 2. 配置你的电脑局域网 IP 和线上域名
const LOCAL_IP = '192.168.70.121';
const PROD_URL = 'https://api.yourdomain.com'; // 未来上线后的正式地址（先用占位符代替）

// 3. 核心判断逻辑
let BASE_HOST = '';

if (isDevTools) {
  // 在电脑开发者工具里，使用 127.0.0.1
  BASE_HOST = 'http://127.0.0.1:8080';
} else {
  // 在真机上运行，使用你的电脑局域网 IP
  // 注意：如果你未来上线了，需要在这里改成判断是否是正式版环境，如果是则使用 PROD_URL
  BASE_HOST = `http://${LOCAL_IP}:8080`;
}

// 4. 导出最终地址
const BASE_URL = `${BASE_HOST}/api`;
const AUTH_BASE_URL = `${BASE_HOST}/api`;
const FILE_BASE_URL = BASE_HOST;

module.exports = { BASE_URL, FILE_BASE_URL, AUTH_BASE_URL }