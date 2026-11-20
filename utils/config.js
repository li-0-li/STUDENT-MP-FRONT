// 1. 获取当前运行环境
const systemInfo = wx.getSystemInfoSync();
// 如果 platform 是 'devtools'，说明在电脑的微信开发者工具里运行；否则就是真机（iOS/Android）
const isDevTools = systemInfo.platform === 'devtools';

// 2. 配置服务端地址（2026-11-20 服务器迁移：旧服务器 47.99.17.173 已下架）
// 公司公共服务器网关：https://192.168.100.3:1061（/api 统一代理后端；自签证书，内网/VPN 可达）
//   服务器后端（p04-backend，1064 直连）已随迁移部署；
//   ★ 学生 MP 新增接口（实时语音 /mp/live/...）尚未部署到服务器，联调期真机连本地后端。
const LOCAL_IP = '192.168.70.121';
const PROD_URL = 'https://192.168.100.3:1061'; // 服务器网关（新接口部署后真机切回此地址）
const DEV_URL = 'http://127.0.0.1:8080';       // 本机后端（连新服务器资源，见 ruoyi-admin 配置）

// 3. 核心判断逻辑
let BASE_HOST = '';

if (isDevTools) {
  // 在电脑开发者工具里，使用本机后端
  BASE_HOST = DEV_URL;
} else {
  // 在真机上运行：联调期连电脑局域网 IP 的本机后端（与电脑同 Wi-Fi，小程序关闭域名校验）；
  // MP 实时语音等新接口部署到服务器后，改为 BASE_HOST = PROD_URL
  BASE_HOST = `http://${LOCAL_IP}:8080`;
}

// 4. 导出最终地址
const BASE_URL = `${BASE_HOST}/api`;
const AUTH_BASE_URL = `${BASE_HOST}/api`;
const FILE_BASE_URL = BASE_HOST;

module.exports = { BASE_URL, FILE_BASE_URL, AUTH_BASE_URL }