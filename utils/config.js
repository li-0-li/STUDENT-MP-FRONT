// 1. 获取当前运行环境
const systemInfo = wx.getSystemInfoSync();
// 如果 platform 是 'devtools'，说明在电脑的微信开发者工具里运行；否则就是真机（iOS/Android）
const isDevTools = systemInfo.platform === 'devtools';

// 2. 配置服务端地址（2026-11-20 服务器迁移：旧服务器 47.99.17.173 已下架）
// 公司公共服务器网关：https://192.168.100.3:1061（/api 统一代理后端；自签证书，内网/VPN 可达）
//   服务器后端（p04-backend，1064 直连）已随迁移部署；
//   ★ 学生 MP 新增接口（实时语音 /mp/live/...）尚未部署到服务器，联调期真机连本地后端。
const LOCAL_IP = '192.168.100.59'; // 2026-11-23 联调更新：电脑 WLAN 当前 IP（换网络时需同步改）
const PROD_URL = 'https://192.168.100.3:1061'; // 服务器网关（新接口部署后真机切回此地址）
const DEV_URL = 'http://127.0.0.1:8080';       // 本机后端（连新服务器资源，见 ruoyi-admin 配置）

// ★ 开发者工具后端开关：'local' = 本机后端；'server' = 公司服务器网关（2026-11-24 新增）
//   服务器网关已有登录/课程等常规接口，但学生 MP 新接口（实时语音 /mp/live/...）未部署，
//   联调语音功能时请切回 'local' 并启动本机后端。
const DEVTOOLS_BACKEND = 'local';

// 3. 核心判断逻辑
let BASE_HOST = '';

if (isDevTools) {
  // 在电脑开发者工具里：按开关选择本机后端或服务器网关
  BASE_HOST = DEVTOOLS_BACKEND === 'server' ? PROD_URL : DEV_URL;
} else {
  // 在真机上运行：联调期连电脑局域网 IP 的本机后端（与电脑同 Wi-Fi，小程序关闭域名校验）；
  // MP 实时语音等新接口部署到服务器后，改为 BASE_HOST = PROD_URL
  BASE_HOST = `http://${LOCAL_IP}:8080`;
}

// 4. 语音桥（2026-11-23 过渡方案：live-pusher/live-player 无类目权限期间）
//    下行 mp3 播放流 + 上行 WS PCM，由本地音频桥进程提供（tools/audio-bridge.js）
const BRIDGE_HOST = isDevTools ? 'http://127.0.0.1:8081' : `http://${LOCAL_IP}:8081`;

// 5. 导出最终地址
const BASE_URL = `${BASE_HOST}/api`;
const AUTH_BASE_URL = `${BASE_HOST}/api`;
const FILE_BASE_URL = BASE_HOST;

module.exports = { BASE_URL, FILE_BASE_URL, AUTH_BASE_URL, BRIDGE_HOST }