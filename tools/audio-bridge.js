// 课堂语音桥接（2026-11-23 过渡方案：小程序 live-pusher/live-player 无权限期间）
// 下行：ffmpeg 按房间并行从服务器 SRS(1071) 拉流 → 转 mp3 → HTTP :8081 广播
//       2026-11-24 重构为多房间并行：旧实现全局单 ffmpeg，两个房间的客户端并存时
//       互相抢锁导致每秒切换/重启，两边都收不到完整流（手机报「当前内容无法播放」的根因）
// 上行：WebSocket 收学生 PCM 分片 → ffmpeg 转 RTMP 推 LiveKit ingress
// 用法：node audio-bridge.js   （端口 8081，仅内网联调用）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const http = require('http');
const { spawn } = require('child_process');
const _ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
const _origLog = console.log.bind(console)
console.log = (...a) => _origLog('[' + _ts() + ']', ...a)  // 全部日志加时间戳，便于对齐手机端复现时刻
const crypto = require('crypto');
const WebSocket = require('ws');

const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const HTTP_PORT = 8081;
// 2026-11-23 实测：服务器 egress 无法主动连办公网设备（192.168.100.59:1935 超时，方向性 ACL），
// 故下行改为 ffmpeg 主动从服务器 SRS(1071) 拉流——办公网→服务器方向畅通
const PULL_BASE = process.env.RTMP_PULL_BASE || 'rtmp://192.168.100.3:1071';
const IDLE_STOP_MS = 30_000  // 房间无收听客户端后延迟停止拉流（防重连抖动）

// ===== 下行：每房间独立 ffmpeg 拉流 + 广播 =====
// rooms: Map<room, { proc, clients:Set<res>, retryTimer, idleTimer }>
const rooms = new Map()

function startDownlink(room) {
  let st = rooms.get(room)
  if (st && st.proc) return  // 该房间已在拉流，直接复用
  if (!st) { st = { proc: null, clients: new Set(), retryTimer: null, idleTimer: null }; rooms.set(room, st) }
  clearTimeout(st.idleTimer)
  const proc = spawn(FF, [
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-analyzeduration', '500000', '-probesize', '65536',
    '-f', 'flv', '-i', `${PULL_BASE}/room/${room}`,
    '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-f', 'mp3', '-flush_packets', '1', 'pipe:1',
    '-loglevel', 'warning'
  ]);
  st.proc = proc
  proc.stdout.on('data', (chunk) => {
    for (const res of st.clients) { try { res.write(chunk); res._bytes = (res._bytes || 0) + chunk.length } catch (e) {} }
  });
  proc.stderr.on('data', (d) => console.log(`[downlink-ffmpeg ${room}]`, String(d).trim()));
  proc.on('close', (code) => {
    console.log(`[downlink] ffmpeg(${room}) 退出 code=${code}（收听中 ${st.clients.size} 人）`)
    if (rooms.get(room) && rooms.get(room).proc === proc) st.proc = null
    // 仅意外退出且有本房间客户端时重启；主动 stop（idleTimer）不重启
    if (st.clients.size > 0 && !st.idleStopped) {
      st.retryTimer = setTimeout(() => startDownlink(room), 3000)
    }
  });
  console.log(`[downlink] ffmpeg 拉 ${PULL_BASE}/room/${room} → mp3 广播（本房间收听 ${st.clients.size} 人）`);
}

function stopDownlink(room) {
  const st = rooms.get(room)
  if (!st) return
  st.idleStopped = true
  clearTimeout(st.retryTimer)
  if (st.proc) { try { st.proc.kill(); } catch (e) {} st.proc = null }
  rooms.delete(room)
  console.log(`[downlink] 房间 ${room} 无收听客户端，停止拉流`)
}

// ===== 上行：WS PCM → RTMP 推 ingress =====
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const pushUrl = url.searchParams.get('pushUrl') || '';
  const identity = url.searchParams.get('identity') || 'unknown';
  if (!/^rtmp:\/\//.test(pushUrl)) {
    ws.close(4000, 'invalid pushUrl');
    return;
  }
  console.log(`[uplink] ${identity} 连接，推 ${pushUrl.slice(0, 40)}...`);
  const ff = spawn(FF, [
    '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0',
    '-c:a', 'aac', '-b:a', '32k', '-ar', '48000', '-f', 'flv', '-flush_packets', '1', pushUrl,
    '-loglevel', 'warning'
  ]);
  ff.stderr.on('data', (d) => console.log(`[uplink-ffmpeg ${identity}]`, String(d).trim().slice(0, 160)));
  ff.on('close', (code) => { console.log(`[uplink] ${identity} ffmpeg 退出 code=${code}`); try { ws.close(); } catch (e) {} });
  ff.stdin.on('error', () => {});
  ws.on('message', (data, isBinary) => { if (isBinary && ff.stdin.writable) ff.stdin.write(data); });
  ws.on('close', () => { console.log(`[uplink] ${identity} 断开，停止推流`); try { ff.stdin.end(); ff.kill(); } catch (e) {} });
  ws.on('error', () => {});
});

// ===== HTTP：mp3 播放流 =====
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!/^\/audio\/[\w.-]+\.mp3$/.test(url.pathname)) {
    res.writeHead(404); res.end('not found'); return;
  }
  // 2026-11-24 响应形态：模拟「渐进式下载大文件」——超大 Content-Length + 禁用 chunked，
  // 手机系统播放器对 chunked 无长度流可能拒绝；对大文件渐进下载全兼容
  const HUGE = 2147483647  // 2GB 虚拟文件长度
  res.useChunkedEncodingByDefault = false
  res.writeHead(206, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': HUGE,
    'Content-Range': 'bytes 0-' + (HUGE - 1) + '/*',
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Connection': 'close'
  });
  const room = url.pathname.replace('/audio/', '').replace(/\.mp3$/, '');
  const st = rooms.get(room) || { proc: null, clients: new Set(), retryTimer: null, idleTimer: null }
  st.idleStopped = false
  rooms.set(room, st)
  st.clients.add(res);
  res._bytes = 0  // 收流统计：断开时打印是否拉到过数据，区分「没拉到」vs「拉到没播」
  console.log(`[mp3] 客户端接入 ${url.pathname} from ${req.socket.remoteAddress} UA=${String(req.headers['user-agent'] || '-').slice(0, 60)}（本房间 ${st.clients.size} 人）`);
  startDownlink(room);
  req.on('close', () => {
    const s = rooms.get(room)
    if (s) { s.clients.delete(res); console.log(`[mp3] 客户端断开 ${url.pathname}（本房间 ${s.clients.size} 人，本次共收到 ${res._bytes || 0} bytes）`) }
    // 空闲延迟停止：无客户端 30 秒后停拉流，避免重连抖动反复启停
    clearTimeout(st.idleTimer)
    st.idleTimer = setTimeout(() => {
      const cur = rooms.get(room)
      if (cur && cur.clients.size === 0) stopDownlink(room)
    }, IDLE_STOP_MS)
  })
});
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/uplink')) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else socket.destroy();
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[bridge] HTTP/WS 监听 :${HTTP_PORT}（mp3: /audio/{room}.mp3，ws: /ws/uplink?pushUrl=，多房间并行拉流）`);
});
