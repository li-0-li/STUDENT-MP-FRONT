// 实时课堂（2026-10-29 改版：删投屏/直播/课堂互动，保留在线人数；新增导航「课堂/随堂测试」）
// 结构：课堂状态卡 → 导航（课堂 | 随堂测试[红点]）
//   课堂 tab：在线人数 + 签到按钮（教师发布签到显红点；五种方式）+ 花名册（只读，10s 轮询自动刷新）
//   随堂测试 tab：当前测试信息 + 开始测试；未发布时空态 + 查看历史测试
// 接入：
//   current 当前课堂发现（GET /sessions/current）→ 按学生选课解析「现在该上哪节课」
//   enter 进入课堂（表 3-13）→ signinState 签到状态（8s 轮询，驱动签到红点与在线人数）
//   signin 课堂签到（表 3-14，支持 numeric 课程码/qr 二维码/location 位置/photo 拍照/gesture 手势）
//   stuRoster 学生花名册；quizCurrent 随堂测试当前状态（驱动测试红点）
// 注：URL 可显式传 sessionId 覆盖（调试口）；未传时按当前进行中的课堂解析，无课显示空态
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const config = require('../../utils/config')
const STATE_POLL = 8000    // 签到状态 + 测试状态轮询间隔
const ROSTER_POLL = 10000  // 花名册轮询间隔（教师加分/标迟到后自动刷新）

// 教师可能开启的签到方式，label 为学生端文案。
// 历史上存在两套命名（教师发布端 code/scan/geofence 与学生端 numeric/qr/location），全部兼容。
const SIGN_WAYS = {
  numeric: '课程码签到',
  code: '课程码签到',
  qr: '二维码签到',
  scan: '二维码签到',
  location: '位置签到',
  geofence: '位置签到',
  photo: '拍照签到',
  gesture: '手势签到'
}

// 教师命名 → 学生端子流程（numeric=输码 / qr=扫码 / location=定位 / photo=拍照 / gesture=手势）
const WAY_FLOW = {
  numeric: 'numeric',
  code: 'numeric',
  qr: 'qr',
  scan: 'qr',
  location: 'location',
  geofence: 'location',
  photo: 'photo',
  gesture: 'gesture'
}

const STAGE_TEXT = { ongoing: '进行中', finished: '已结束', scheduled: '未开始', waiting: '等待开课' }

// ===== 实时画布（2026-11-16）：搬运自教师/学生PC端舞台同步链路 =====
// 帧管道（全部现成）：教师 WS 上行 slide/stroke/clear/snapshot → SessionBroadcastBridge
//   → /ws/session/{id} 信封 {type, seq, rev, payload}。快照 REST：/stu/live/sessions/{id}/stage。
// 帧应用语义 1:1 对照 StuPcCastStageState.apply（学生PC参考实现）：换课件/翻页清笔迹、
//   stroke 按 id 去重增量绘制、snapshot/state-reset 全量覆盖重放。
//
// ===== 教师小程序批注链路（2026-11-18 新增）=====
// 教师-mp 走另一条路：REST 批注落库 live_annotation + 广播 courseware_open/courseware_page/
//   annotation 帧（普通路径，无 seq/rev 信封）。批注操作流按 docId+page 隔离：
//   add={c,w,pts:[x,y,...],sid}（pts 为扁平奇数序列，0~1 归一化）；undo={sid} 撤同一笔全部分段；
//   clear 清空当页。翻页帧不带批注 → 学生端切页后拉 REST /courseware 重放当页操作流。
const STAGE_FRAME_TYPES = ['slide', 'stroke', 'clear', 'snapshot', 'state-reset']
const STAGE_SLIDE_KEYS = ['resourceId', 'name', 'stepIndex', 'stepNo', 'page', 'index']
const ANN_FRAME_TYPES = ['annotation', 'courseware_page', 'courseware_open']

/** 笔迹 payload → 可绘线段（points 兼容 [[x,y]]、{x,y} 与 "x y" 字符串；坐标归一化到 0-1） */
function normalizeStroke(p) {
  if (!p) return null
  const raw = Array.isArray(p.points) ? p.points : []
  const pts = raw.map(function (pt) {
    // 服务端快照/帧的 points 是 "0.2892 0.3439" 字符串（2026-11-18 修复：此前全解析成 NaN 被丢弃，画布空白）
    if (typeof pt === 'string') {
      const pair = pt.trim().split(/\s+/)
      return { x: Number(pair[0]), y: Number(pair[1]) }
    }
    if (Array.isArray(pt)) return { x: Number(pt[0]), y: Number(pt[1]) }
    return { x: Number(pt && pt.x), y: Number(pt && pt.y) }
  }).filter(function (q) { return isFinite(q.x) && isFinite(q.y) })
  if (!pts.length) return null
  // 坐标口径自适应：全 ≤1 视为已归一化；否则按点集最大值等比压到 0-1（fit-to-canvas）
  const maxV = Math.max.apply(null, pts.map(function (q) { return Math.max(q.x, q.y) }))
  if (maxV > 1.5) pts.forEach(function (q) { q.x = q.x / maxV; q.y = q.y / maxV })
  return { id: p.id || null, color: p.color || '#e11d48', width: Number(p.width) || 3, points: pts }
}

/** '2026-10-08T10:25:05' → '10:25' */
function hmOf(iso) { return (iso || '').slice(11, 16) }

/** 教师-mp 批注 stroke {c,w,pts:[x0,y0,x1,y1,...],sid} → 可绘线段（pts 扁平序列 → 点数组） */
function normalizeAnnStroke(s) {
  if (!s || !Array.isArray(s.pts)) return null
  const pts = []
  for (let i = 0; i + 1 < s.pts.length; i += 2) {
    const x = Number(s.pts[i])
    const y = Number(s.pts[i + 1])
    if (isFinite(x) && isFinite(y)) pts.push({ x: x, y: y })
  }
  if (!pts.length) return null
  return { sid: s.sid || null, color: s.c || '#e11d48', width: Number(s.w) || 3, points: pts }
}

/** '2026-10-08 10:25:05' 或 ISO → 分钟时间戳（比较截止用） */
function toTs(s) {
  if (!s) return 0
  return new Date(String(s).replace('T', ' ').replace(/-/g, '/')).getTime()
}

Page({
  data: {
    sessionId: 0,
    loading: true,
    noClass: false,   // 当前没有进行中的课堂（教师未开课）
    // 课堂状态卡（enter 填充）
    current: {
      course: '',
      week: '',
      teacher: '',
      room: '',
      section: '',
      stage: '',
      signed: 0,      // 已签到人数（8s 轮询刷新）
      should: 0,      // 应到人数（选课人数）
      online: 0       // 学生在线人数（WebSocket 连接数，服务端 presence 广播 + 轮询兜底）
    },
    // ===== 导航 =====
    tab: 'class',        // class 课堂 | chat 聊天 | quiz 随堂测试
    quizDot: false,     // 随堂测试红点：有新测试且未首次查看
    // ===== 课堂聊天（2026-11-20 在线互动，口径对齐学生端 PC）=====
    messages: [],        // [{messageId, senderId, senderName, content, sendTime, mine, timeShort}]
    chatInput: '',
    chatScrollInto: '',  // scroll-into-view 锚点（最新消息）
    chatDot: false,      // 聊天红点：不在聊天 tab 时收到新消息
    msgLastId: 0,        // 已渲染最大 messageId（历史增量游标）
    // ===== 签到 =====
    signed: false,
    signedTime: '',
    signinDot: false,    // 签到红点：教师发布签到且我未签且未过期
    // 签到面板（type 选择 + 各方式子面板）
    signinPanel: false,
    signinWays: [],      // 本次任务开启的方式 [{key,label}]
    codeInput: '',       // numeric 课程码输入
    gestureShow: false,  // 手势面板
    gestureDots: [],     // 已点亮点位（1-9 序列）
    // ===== 花名册 =====
    rosterShow: false,
    roster: [],          // [{name, perfScore, lateCount, absentCount}]
    rosterTotal: 0,
    // ===== 随堂测试 =====
    quiz: {
      quizId: null,
      title: '',
      deadline: '',
      active: false,
      submitted: false,
      correctCount: null,
      total: 0,
      courseId: null
    },
    // ===== 实时画布（2026-11-16）=====
    stageName: '',        // 课件名
    stagePage: 0,         // 当前页
    stageTotal: 0,        // 总页数
    stageEmpty: true,     // 教师尚未展示任何内容
    stageFull: false,     // 画板全屏模式（2026-11-18）
    // 统一文件视图（2026-11-18 多类型）：kind = pages|image（画布渲染）/ video（视频组件）/ native（openDocument）
    stageKind: '',
    stageFileUrl: '',
    stageFileName: '',
    stageLoadFail: false, // 页图加载失败（接口/拉图异常）：画布区显示失败提示而非静默白底（2026-11-20）
    // ===== 实时语音（2026-11-20，LiveKit RTMP 桥）=====
    audioState: 'idle',   // idle 初始 / loading 连接中 / listening 收听中 / offline 仅同步课件降级
    audioMuted: false,    // 被教师禁言（audio-mic WS 帧驱动）
    audioMicOn: false,    // 已开麦（live-pusher 推流中）
    audioPullUrl: '',     // 课堂合成音拉流地址
    audioPushUrl: ''      // 开麦推流地址
  },

  onLoad(options) {
    this.stateTimer = null
    this.rosterTimer = null
    const explicit = Number(options.sessionId) || 0
    if (explicit) {
      // 独立课堂入口（2026-11-18 调试口转正）：home/schedule 的「进入课堂」按钮按各课
      // scheduleId 解析出各自的课堂会话后带 sessionId 进入，多课同窗不再共用全局发现
      this.setData({ sessionId: explicit })
      this.enterClass()
      this.refreshState()
      return
    }
    this.resolveCurrent()
  },

  /** 当前课堂发现：按我的选课解析进行中的课堂；教师未开课 → 空态 */
  async resolveCurrent() {
    let cur = null
    try { cur = await api.classroom.current() } catch (e) { /* request 层已 toast */ }
    // 兼容驼峰/下划线两种键名（后端返回 session_id）
    const sid = Number(cur.sessionId || cur.session_id || 0)
    if (sid > 0) {
      // 名称兜底（2026-11-18）：current 响应已含课程/教师/教室名，先填充头部卡；
      // enter 响应随后覆盖（含节次/状态等完整字段），避免 enter 失败时名称空白
      const c0 = this.data.current || {}
      this.setData({
        sessionId: sid,
        current: {
          ...c0,
          course: c0.course || cur.course_name || cur.courseName || '',
          teacher: c0.teacher || cur.teacher_name || cur.teacherName || '',
          room: c0.room || cur.classroom_name || cur.classroomName || ''
        }
      })
      this.enterClass()
      this.refreshState()
      this.connectWS()   // onShow 抢跑时 sessionId 还是 0，解析完成后再连 WS
      return
    }
    this.setData({ loading: false, noClass: true })
  },

  onShow() { this.pageVisible = true; this.startTimers(); this.connectWS() },
  onHide() { this.stopTimers(); this.closeWS(); this.pageVisible = false },
  onUnload() {
    this.stopTimers(); this.closeWS(); this.pageVisible = false
    // 画布初始化重试定时器与全屏画布引用清理（2026-11-18）
    if (this.canvasRetry) { clearTimeout(this.canvasRetry); this.canvasRetry = null }
    if (this.fullCanvasRetry) { clearTimeout(this.fullCanvasRetry); this.fullCanvasRetry = null }
    this.fullCanvas = null
    this.fullCtx = null
    // 实时语音清理（2026-11-20）：卸载推流组件释放麦克风占用；拉流随页面销毁自动释放
    if (this.data.audioMicOn) this.setData({ audioMicOn: false, audioPushUrl: '' })
    this.setData({ audioPullUrl: '' })
  },

  /** 全屏覆盖层拦截滚动（wxml catchtouchmove 占位） */
  noop() {},

  // ===== WebSocket 在线状态（连接即「在线」，服务端按学生连接数统计并广播） =====

  connectWS() {
    this.closeWS()
    const token = auth.getToken()
    // 课堂未解析到（sessionId=0，onShow 可能先于 resolveCurrent 完成）或页面不可见时不连接，
    // 解析成功后由 resolveCurrent 补连
    if (!token || !this.pageVisible || !this.data.sessionId) return
    const wsBase = config.BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '')
    this.wsVisible = true
    this.wsTask = wx.connectSocket({ url: wsBase + '/ws/session/' + this.data.sessionId + '?token=' + token })
    this.wsTask.onOpen(() => { this.refreshState(); this.fetchStage(); this.fetchCourseware(); this.initCanvas(); this.fetchChatHistory() })
    this.wsTask.onMessage((msg) => this.onWSMessage(msg))
    this.wsTask.onClose(() => {
      this.wsTask = null
      // 页面仍可见 → 5s 后重连（断网恢复/服务端重启场景）
      if (this.wsVisible) {
        this.wsRetry = setTimeout(() => { if (this.wsVisible) this.connectWS() }, 5000)
      }
    })
    this.wsTask.onError(() => { /* 随后触发 onClose 走重连 */ })
  },

  closeWS() {
    this.wsVisible = false
    if (this.wsRetry) { clearTimeout(this.wsRetry); this.wsRetry = null }
    if (this.wsTask) {
      try { this.wsTask.close({}) } catch (e) { /* 已断开 */ }
      this.wsTask = null
    }
  },

  /** 服务端下行 {type,payload}：presence 在线人数实时更新；session_end 课堂被结束（含超时自动关闭） */
  onWSMessage(msg) {
    try {
      const m = JSON.parse(msg.data || '{}')
      this.trackStageSeq(m)   // 舞台帧 seq 缺口检测（通信丢帧兜底，2026-11-20）
      // 实时画布帧（2026-11-16）：slide/stroke/clear/snapshot/state-reset 直接应用
      if (STAGE_FRAME_TYPES.indexOf(m.type) >= 0) {
        this.applyStageFrame(m.type, m.payload)
        return
      }
      // 教师-mp 课件批注帧（2026-11-18）：courseware_open/courseware_page/annotation
      if (ANN_FRAME_TYPES.indexOf(m.type) >= 0) {
        this.applyCoursewareFrame(m.type, m.payload)
        return
      }
      // 教师禁言/恢复学生麦克风（2026-11-20 实时语音）：MP 端无 LiveKit 连接，靠此帧同步状态
      if (m.type === 'audio-mic' && m.payload) {
        this.onAudioMicFrame(m.payload)
        return
      }
      if (m.type === 'presence' && m.payload && typeof m.payload.onlineCount === 'number') {
        this.setData({ 'current.online': m.payload.onlineCount })
      } else if (m.type === 'chat' && m.payload) {
        // 课堂聊天实时帧（2026-11-20）：{messageId,senderId,senderName,content,sendTime}
        this.appendChat(m.payload)
      } else if (m.type === 'error' && m.payload && m.payload.message) {
        // 上行被拒（限流/长度/身份）：toast 提示，2s 节流防轰炸
        const now = Date.now()
        if (!this._lastErrToast || now - this._lastErrToast > 2000) {
          this._lastErrToast = now
          wx.showToast({ title: m.payload.message, icon: 'none' })
        }
      } else if (m.type === 'session_end' && m.payload) {
        // 课堂被结束（教师手动 / 下课 5 分钟后超时自动）：断开连接并回到空态
        wx.showToast({ title: '本节课已结束', icon: 'none' })
        this.closeWS()
        this.setData({ noClass: true, loading: false })
      }
    } catch (e) { /* 非业务消息忽略 */ }
  },

  // ===== 课堂聊天（2026-11-20 在线互动）=====

  /** 进课堂/WS 重连后按游标增量拉历史（既有接口 GET /sessions/{id}/messages?sinceId=，字段下划线） */
  async fetchChatHistory() {
    if (!this.data.sessionId) return
    try {
      // 仅增量拉取时携带 sinceId（正整数游标）；首屏传空参数对象——
      // null 值会被 wx.request 序列化成 "sinceId=null" 字符串，后端 Long 转换失败返回
      // 400「参数 sinceId 格式不正确」，阻断课堂内容加载（2026-11-20 修复）
      const params = {}
      if (this.data.msgLastId > 0) {
        params.sinceId = this.data.msgLastId
      }
      const res = await api.classroom.messages(this.data.sessionId, params)
      const list = (res && (res.data || res)) || []
      if (Array.isArray(list) && list.length) {
        this.mergeChat(list)
      }
    } catch (e) { /* 历史拉取失败不影响实时帧，重连会再拉 */ }
  },

  /** 合并消息（messageId 去重、升序、更新游标与滚动锚点；兼容驼峰/下划线两种键名） */
  mergeChat(list) {
    const seen = this._chatSeen || (this._chatSeen = {})
    const add = []
    for (const raw of list) {
      if (!raw) continue
      const mid = raw.messageId != null ? raw.messageId : raw.message_id
      if (mid == null || seen[mid]) continue
      seen[mid] = true
      const senderId = raw.senderId != null ? raw.senderId : raw.sender_id
      const sendTime = raw.sendTime || raw.send_time || ''
      add.push({
        messageId: Number(mid),
        senderId: Number(senderId),
        senderName: raw.senderName || raw.sender_name || '同学',
        content: raw.content,
        msgType: raw.msgType || 'text',
        duration: Number(raw.duration) || 0,
        mine: !!raw.mine || (this.myUserId != null && Number(senderId) === Number(this.myUserId)),
        timeShort: String(sendTime).slice(11, 16)
      })
    }
    if (!add.length) return
    const messages = this.data.messages.concat(add).sort((a, b) => a.messageId - b.messageId)
    const last = messages[messages.length - 1]
    this.setData({
      messages,
      msgLastId: last.messageId,
      chatScrollInto: 'msg-' + last.messageId,
      // 不在聊天 tab 时收到新消息 → 红点提示
      chatDot: this.data.tab !== 'chat' ? true : this.data.chatDot
    })
  },

  /** WS 实时 chat 帧 → 渲染（自己发的帧也会广播回来，messageId 去重兜底） */
  appendChat(payload) {
    this.mergeChat([payload])
  },

  /** 上行封装：{type,payload}；未连接返回 false（发送降级 REST） */
  wsSend(type, payload) {
    if (!this.wsTask) return false
    try {
      this.wsTask.send({ data: JSON.stringify({ type, payload }) })
      return true
    } catch (e) { return false }
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  /** 发送聊天：WS 上行 {type:'chat',payload:{content}}，失败降级 REST sendMessage；500ms 节流防误触连发 */
  async sendChat() {
    const content = (this.data.chatInput || '').trim()
    if (!content) return
    const now = Date.now()
    if (this._lastChatSend && now - this._lastChatSend < 500) return
    this._lastChatSend = now
    if (content.length > 500) {
      wx.showToast({ title: '消息过长，最多 500 字', icon: 'none' })
      return
    }
    const ok = this.wsSend('chat', { content })
    if (ok) {
      // 等广播帧回显（自己发的也会广播回来）；清空输入
      this.setData({ chatInput: '' })
      return
    }
    // WS 未连接：降级 REST（同样入库+广播），成功后本地直接补显
    try {
      await api.classroom.sendMessage(this.data.sessionId, { content, msgType: 'text' })
      this.setData({ chatInput: '' })
      this.fetchChatHistory()
    } catch (e) {
      wx.showToast({ title: '发送失败，请稍后重试', icon: 'none' })
    }
  },

  // ===== 实时画布（2026-11-16）：状态、快照与渲染 =====

  /** 进课堂/重连后拉权威快照（student-pc 模块 REST，同单体同鉴权），全量重建画布 */
  async fetchStage() {
    if (!this.data.sessionId) return
    try {
      const st = await api.classroom.liveStage(this.data.sessionId)
      const data = (st && (st.data || st)) || null
      if (!data || (!data.slide && !(data.strokes && data.strokes.length))) {
        this.ensureStage().slide = {}
        this.setData({ stageEmpty: true })
        this.redrawStage()
        return
      }
      // 顶层字段映射（2026-11-18）：快照出参 name/page/totalPages/resourceId 在顶层而非 slide 内，
      // 不映射则 syncStageUI 拿不到课件名 → 误判「教师未展示内容」隐藏画布
      this.ensureStage().slide = data.slide || {
        name: data.name || '',
        resourceId: data.resourceId,
        page: data.page,
        totalPages: data.totalPages,
        stepIndex: data.stepIndex
      }
      ;(data.strokes || []).forEach((s) => this.mergeStroke(s))
      this.syncStageUI()
      // 中途进入/刷新/重连（2026-11-18）：快照恢复后按 resourceId+page 重载画布背景
      this.loadPageImage()
      this.redrawStage()
    } catch (e) { /* 403 非选课名单 / 教师未开画布：静默保持空态 */ }
  },

  // ===== 教师-mp 课件批注链路（2026-11-18）=====

  /** 画布状态懒初始化（两条链路共用一个 stage 对象） */
  ensureStage() {
    if (!this.stage) {
      this.stage = { slide: {}, strokes: [], byId: {}, ann: [], annSid: {}, annSeq: 0, doc: null }
    }
    return this.stage
  },

  /** 中途进入/刷新/重连后拉教师-mp 课件批注状态（与 WS 帧互补的权威快照） */
  async fetchCourseware() {
    if (!this.data.sessionId) return
    try {
      const res = await api.classroom.liveCourseware(this.data.sessionId)
      const d = (res && (res.data || res)) || null
      if (!d || !d.docId) return   // 教师未上传课件：保持空态
      const st = this.ensureStage()
      st.doc = {
        docId: d.docId,
        page: Number(d.page) || 1,
        total: Number(d.total) || 0,
        fileName: d.fileName || ''
      }
      // 按页图路径准备底图
      const pages = Array.isArray(d.pages) ? d.pages : []
      const cur = pages.filter((p) => Number(p.pageNo) === st.doc.page)[0]
      st.doc.url = cur ? cur.imagePath : null
      // 全量重放当前页批注操作流
      st.ann = []
      st.annSid = {}
      st.annSeq = 0
      this.replayAnnOps(Array.isArray(d.annotations) ? d.annotations : [])
      this.syncStageUI()
      this.loadPageImage()
      this.redrawStage()
    } catch (e) { /* 403 非选课名单 / 教师未上传课件：静默保持空态 */ }
  },

  /** 按操作流顺序重放批注（add → 画 / undo → 按 sid 删 / clear → 清空） */
  replayAnnOps(ops) {
    ops.forEach((item) => {
      const op = (item && item.op || '').toLowerCase()
      const s = item && item.stroke
      if (op === 'add') {
        const stroke = normalizeAnnStroke(s)
        if (!stroke) return
        if (item.seq && item.seq <= this.ensureStage().annSeq) return
        this.ensureStage().annSeq = item.seq || this.ensureStage().annSeq
        this.stage.ann.push(stroke)
        if (stroke.sid) {
          if (!this.stage.annSid[stroke.sid]) this.stage.annSid[stroke.sid] = []
          this.stage.annSid[stroke.sid].push(stroke)
        }
      } else if (op === 'undo') {
        this.undoAnnBySid(s && s.sid)
      } else if (op === 'clear') {
        this.stage.ann = []
        this.stage.annSid = {}
      }
    })
  },

  /**
   * 教师-mp 课件帧应用（courseware_open / courseware_page / annotation）
   *
   * <p>与家族A（slide/stroke）互不覆盖：批注层单独按 docId+page 管理，
   * 翻页时只清批注层并拉 REST 重放该页；PC 板书层由 applyStageFrame 负责。</p>
   */
  applyCoursewareFrame(type, payload) {
    if (!payload || typeof payload !== 'object') return
    const st = this.ensureStage()
    if (type === 'courseware_open' || type === 'courseware_page') {
      const prevKey = st.doc ? st.doc.docId + ':' + st.doc.page : ''
      st.doc = {
        docId: payload.docId,
        page: Number(payload.page) || st.doc && st.doc.page || 1,
        total: Number(payload.total) || 0,
        fileName: payload.fileName || (st.doc && st.doc.fileName) || '',
        url: payload.url || null
      }
      const nextKey = st.doc.docId + ':' + st.doc.page
      if (nextKey !== prevKey) {
        // 换课件或翻页：清空批注层 + 换底图 + 拉该页批注重放（翻页帧不带批注）
        st.ann = []
        st.annSid = {}
        st.annSeq = 0
        this.loadPageImage()
        this.fetchAnnPage()
      }
      this.syncStageUI()
      this.redrawStage()
      return
    }
    if (type === 'annotation') {
      // 只渲染当前页的批注；其他页的帧忽略（翻回去时由 REST 重放补齐）
      if (!st.doc || payload.page !== st.doc.page) return
      const seq = Number(payload.seq) || 0
      if (seq && seq <= st.annSeq) return   // seq 单调去重（重发/重放双保险）
      const op = (payload.op || '').toLowerCase()
      if (op === 'add') {
        const stroke = normalizeAnnStroke(payload.stroke)
        if (!stroke) return
        st.annSeq = seq || st.annSeq
        st.ann.push(stroke)
        if (stroke.sid) {
          if (!st.annSid[stroke.sid]) st.annSid[stroke.sid] = []
          st.annSid[stroke.sid].push(stroke)
        }
        this.drawAnn(stroke)   // 增量画一笔
      } else if (op === 'undo') {
        this.undoAnnBySid(payload.stroke && payload.stroke.sid)
        this.redrawStage()
      } else if (op === 'clear') {
        st.ann = []
        st.annSid = {}
        st.annSeq = seq || st.annSeq
        this.redrawStage()
      }
    }
  },

  /** 教师撤销：按 sid 删掉同一笔的全部分段（一笔 80ms 分段上报会产生多条） */
  undoAnnBySid(sid) {
    if (!sid || !this.stage) return
    if (this.stage.annSid[sid]) delete this.stage.annSid[sid]
    this.stage.ann = this.stage.ann.filter((s) => s.sid !== sid)
  },

  /** 翻页后拉当前页批注重放（REST，权威口径） */
  async fetchAnnPage() {
    if (!this.data.sessionId || !this.stage || !this.stage.doc) return
    const st = this.stage
    const key = st.doc.docId + ':' + st.doc.page
    try {
      const res = await api.classroom.liveCourseware(this.data.sessionId)
      const d = (res && (res.data || res)) || null
      if (!d || !d.docId) return
      // 响应回来期间教师又翻了页：丢弃过期响应
      if (!st.doc || (st.doc.docId + ':' + st.doc.page) !== key) return
      st.ann = []
      st.annSid = {}
      st.annSeq = 0
      const pages = Array.isArray(d.pages) ? d.pages : []
      const cur = pages.filter((p) => Number(p.pageNo) === st.doc.page)[0]
      if (cur) st.doc.url = cur.imagePath
      this.replayAnnOps(Array.isArray(d.annotations) ? d.annotations : [])
      this.loadPageImage()
      this.redrawStage()
    } catch (e) { /* 静默：批注恢复失败不影响实时帧 */ }
  },

  /**
   * 加载当前页底图（统一入口，2026-11-18 分流两条链路）：
   * ① 教师-pc 链路：slide.resourceId 有值 → 调 stage-bg 接口由后端 PDFBox 渲染 PDF 该页
   *    PNG（教师 PC 的 pdf.js 页图只在教师浏览器内存里，小程序拿不到，必须由后端补渲染）；
   * ② 教师-mp 链路：doc.url（live_courseware_page 页图，教师上传时已落图）→ 直接加载。
   * 图片加载完成后整帧重绘。
   * ★ 竞态契约（2026-11-20）：this.canvas 未就绪时静默跳过——由 initCanvas 就绪回调补调
   *   本方法兜底（fetchStage 快照 / slide 帧先于 canvas 就绪到达时，底图在此被丢弃、
   *   在 initCanvas 就绪后被补加载），两处调用缺一不可。
   */
  loadPageImage() {
    if (!this.canvas || !this.stage) return
    const slide = this.stage.slide || {}
    if (slide.resourceId) {
      // 教师-pc 链路：统一文件视图分流（pdf/ppt→页图、图片→直显、视频→组件、doc→原生预览）
      this.loadStageFile()
      return
    }
    if (!this.stage.doc) return
    const url = this.stage.doc.url
    if (!url) { this.stage.img = null; this.stage.imgRect = null; return }
    const full = /^(https?:|wxfile:|blob:)/.test(url) ? url
      : config.BASE_URL.replace(/\/api$/, '') + url
    const img = this.canvas.createImage()
    img.onload = () => {
      if (!this.stage || !this.stage.doc) return
      this.stage.img = img
      // 记录原始尺寸：paintTo 按目标画布 contain 重算（全屏横屏放大适配）
      this.stage.imgSize = { iw: img.width || 1, ih: img.height || 1 }
      // 底图 contain 适配：批注坐标相对底图区域（教师端画布即课件图），非整画布
      const iw = img.width || 1
      const ih = img.height || 1
      const scale = Math.min(this.canvasW / iw, this.canvasH / ih)
      const w = iw * scale
      const h = ih * scale
      this.stage.imgRect = { x: (this.canvasW - w) / 2, y: (this.canvasH - h) / 2, w: w, h: h }
      this.redrawStage()
    }
    img.onerror = () => { this.stage.img = null; this.stage.imgRect = null; this.redrawStage() }
    img.src = full
  },

  /**
   * 教师-pc 链路底图：按 slide.resourceId + page 调后端 stage-bg 接口，
   * 拉取 PDFBox 渲染的 PDF 页图（MinIO 缓存）作画布背景（2026-11-18）。
   * 带 bgKey 去重与翻页竞态防护（接口返回/图片加载完成时若页已再变则丢弃）；
   * 非 PDF 课件 / 渲染失败 / 接口失败 → 白底降级，不影响笔迹层。
   */
  loadStageFile() {
    const slide = (this.stage && this.stage.slide) || {}
    const rid = slide.resourceId
    const page = Number(slide.page) || 1
    if (!rid || !this.data.sessionId) return
    const key = rid + ':' + page
    if (this.stage.bgKey === key && this.stage.img) return   // 同页底图已加载
    this.stage.bgKey = key
    this.stage.img = null
    this.stage.imgRect = null
    // 请求序号竞态防护：翻页/切课件后旧请求返回直接丢弃
    const reqId = (this._stageReqId = (this._stageReqId || 0) + 1)
    api.classroom.stageFile(this.data.sessionId, rid, page).then((r) => {
      if (this._stageReqId !== reqId) return
      const d = (r && (r.data || r)) || {}
      const kind = d.kind || 'none'
      if (kind === 'video' || kind === 'native') {
        // 视频/原生文档：画布不渲染页图，切换为 video 组件 / openDocument 卡片
        if (this.stage) { this.stage.img = null; this.stage.imgRect = null }
        this.redrawStage()
        this.setData({ stageKind: kind, stageFileUrl: d.url || '', stageFileName: d.fileName || '', stageLoadFail: false })
        return
      }
      this.setData({ stageKind: kind === 'pages' || kind === 'image' ? kind : '' })
      const url = d.url ? this.fileUrlFull(d.url) : ''
      const st = this.stage
      if (!url || !st || !st.slide) {
        // 渲染失败/非页图类：白底降级（笔迹仍可看），置失败态给出可见提示
        this.setData({ stageLoadFail: true })
        this.redrawStage()
        return
      }
      // 竞态①：接口返回时页已再变 → 丢弃（新的 loadStageFile 已在跑）
      if (st.bgKey !== key) return
      const img = this.canvas.createImage()
      img.onload = () => {
        const cur = this.stage
        // 竞态②：图片加载完成时页又再变 → 丢弃
        if (!cur || cur.bgKey !== key) return
        cur.img = img
        // 记录原始尺寸：paintTo 按目标画布 contain 重算（全屏横屏放大适配）
        cur.imgSize = { iw: img.width || 1, ih: img.height || 1 }
        // 底图 contain 居中（与教师端 pdf.js / POI 渲染同口径）；
        // PC 板书坐标相对整画布，直接画（不经 imgRect）
        const iw = img.width || 1
        const ih = img.height || 1
        const scale = Math.min(this.canvasW / iw, this.canvasH / ih)
        const w = iw * scale
        const h = ih * scale
        cur.imgRect = { x: (this.canvasW - w) / 2, y: (this.canvasH - h) / 2, w: w, h: h }
        this.setData({ stageLoadFail: false })   // 加载成功清除失败态
        this.redrawStage()
      }
      img.onerror = () => {
        // 拉图失败（预签名过期/网络/域名白名单）：不再静默白底，给出可见提示引导重试
        this.setData({ stageLoadFail: true })
        this.redrawStage()
      }
      img.src = url
    }).catch(() => {
      // 接口失败：白底降级不影响笔迹层，但置失败态避免「无报错但内容缺失」
      this.setData({ stageLoadFail: true })
    })
  },

  /** 相对路径完整化：本地口径返回 /profile/...，前端拼 FILE_BASE_URL；MinIO 预签名已完整 */
  fileUrlFull(url) {
    if (!url) return ''
    if (/^https?:/i.test(url)) return url
    const base = config.FILE_BASE_URL || config.BASE_URL.replace(/\/api$/, '')
    return base + url
  },

  /** 原生文档预览（kind=native）：下载后 wx.openDocument（微信支持 doc/docx/ppt/pptx/xls/pdf） */
  openStageDoc() {
    const url = this.fileUrlFull(this.data.stageFileUrl)
    if (!url) return
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
    wx.showLoading({ title: '加载中…', mask: true })
    wx.downloadFile({
      url: url,
      success: (res) => {
        wx.hideLoading()
        if (res.statusCode !== 200) {
          wx.showToast({ title: '加载失败（' + res.statusCode + '）', icon: 'none' })
          return
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: ext,
          showMenu: true,
          fail: () => wx.showToast({ title: '该格式暂不支持预览', icon: 'none' })
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '加载失败，请检查网络', icon: 'none' })
      }
    })
  },

  /**
   * 舞台帧 seq 连续性检测（2026-11-20 通信丢帧兜底）：
   * envelope 携带服务端递增 seq（digest 每 5s 一帧、内容帧随教师操作）。
   * 内容帧（slide/stroke/clear/snapshot/state-reset）出现缺口 → 中间可能丢了 stroke 帧
   * （笔迹缺失），防抖重拉权威快照全量对齐；digest/playback 等非内容帧只推进游标不触发。
   */
  trackStageSeq(m) {
    const seq = m && m.seq
    if (typeof seq !== 'number') return
    const isDigest = m.type === 'state-digest' || m.type === 'playback' || m.type === 'audio-marker'
    if (!isDigest && this._stageSeq != null && seq > this._stageSeq + 1) {
      const now = Date.now()
      if (!this._gapFetchAt || now - this._gapFetchAt > 1000) {
        this._gapFetchAt = now
        this.fetchStage()   // 快照含合并后的完整笔迹，重拉即恢复
      }
    }
    if (seq > (this._stageSeq || 0)) this._stageSeq = seq
  },

  /** 帧应用（语义对照 StuPcCastStageState.apply）+ 画布增量刷新 */
  applyStageFrame(type, payload) {
    if (!payload || typeof payload !== 'object') payload = {}
    this.ensureStage()
    if (type === 'slide') {
      const changed = STAGE_SLIDE_KEYS.some((k) =>
        payload[k] !== undefined && String(payload[k]) !== String(this.stage.slide[k]))
      STAGE_SLIDE_KEYS.forEach((k) => { if (payload[k] !== undefined) this.stage.slide[k] = payload[k] })
      if (changed) {
        this.stage.strokes = []; this.stage.byId = {}
        // 背景/翻页同步（2026-11-18）：课件或页码变化 → 重载底图（PC 链路 PDF 页图 / mp 链路页图）
        this.loadPageImage()
      }
    } else if (type === 'stroke') {
      const s = normalizeStroke(payload)
      if (s) {
        const prev = s.id ? this.stage.byId[s.id] : null
        if (prev && prev.points) {
          // ★ 笔迹断触修复（2026-11-20）：教师端一笔是分批增量上行（同一 stroke id 多帧，
          //   每帧带新增点段），服务端权威状态 StuPcCastStageState.mergeStroke 对同 id 是
          //   「追加 points」——此前这里把同 id 帧当重发丢弃，每笔只画出第一批点。
          //   对齐合并语义：追加到既有笔迹（strokes 与 byId 同引用），重画整笔覆盖旧笔迹
          //   （polyline 不透明重画视觉一致，无需先擦除）。
          prev.points = prev.points.concat(s.points)
          this.drawIncremental(prev)
        } else {
          if (s.id) this.stage.byId[s.id] = s
          this.stage.strokes.push(s)
          this.drawIncremental(s)                   // 新一笔增量绘制（主画布 + 全屏画布）
        }
      }
      this.syncStageUI()
      return
    } else if (type === 'clear') {
      this.stage.strokes = []
      this.stage.byId = {}
    } else if (type === 'snapshot' || type === 'state-reset') {
      STAGE_SLIDE_KEYS.forEach((k) => { if (payload[k] !== undefined) this.stage.slide[k] = payload[k] })
      this.stage.strokes = []
      this.stage.byId = {}
      ;(Array.isArray(payload.strokes) ? payload.strokes : []).forEach((s) => this.mergeStroke(s))
    } else {
      return   // playback / audio-marker / state-digest：首期忽略
    }
    this.syncStageUI()
    this.redrawStage()
  },

  mergeStroke(payload) {
    const s = normalizeStroke(payload)
    if (!s) return
    if (s.id && this.stage.byId[s.id]) return
    if (s.id) this.stage.byId[s.id] = true
    this.stage.strokes.push(s)
  },

  /** 课件名/页码 UI 同步（兼容两条链路：PC 板书 slide 帧 / 教师-mp 批注 doc） */
  syncStageUI() {
    const s = this.stage || {}
    const pcName = s.slide && (s.slide.name || s.slide.resourceId) || ''
    const mpName = s.doc && (s.doc.fileName || (s.doc.docId ? '课件' : '')) || ''
    const name = pcName || mpName
    const page = Number(s.doc && s.doc.page) || Number(s.slide && (s.slide.page || s.slide.stepNo)) || 0
    const total = Number(s.doc && s.doc.total) || Number(s.slide && s.slide.totalPages) || 0
    const hasAnn = s.doc && s.doc.docId && (s.doc.url || (s.ann && s.ann.length) || total)
    this.setData({
      stageEmpty: !name && !hasAnn,
      stageName: name || '',
      stagePage: page,
      stageTotal: total
    })
    // 空态 → 非空态时 canvas 刚变为可见/可查询，补一次初始化（2026-11-18 修复：
    // 此前 initCanvas 只在 WS onOpen 调一次，slide 帧首次到达时节点尚不可查、ctx 永不建立，
    // 笔迹帧到达后 redarw 因 ctx 空全部空跑——这就是「收到课件名但笔迹不显示」的根因）
    if (this.data.stageEmpty === false) this.initCanvas()
  },

  /** canvas 2d 节点初始化（尺寸 × dpr），完成后补加载底图再重绘当前状态 */
  initCanvas() {
    if (this.canvas) { this.redrawStage(); return }
    const q = wx.createSelectorQuery().in(this)
    q.select('#stageCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node || !res[0].width) {
        // 节点尚未就绪（hidden 刚解除/页面刚渲染），延迟重试一次
        if (!this.canvasRetry) {
          this.canvasRetry = setTimeout(() => { this.canvasRetry = null; if (this.pageVisible) this.initCanvas() }, 300)
        }
        return
      }
      this.canvasRetry && (clearTimeout(this.canvasRetry), this.canvasRetry = null)
      const node = res[0].node
      const width = res[0].width
      const height = res[0].height
      const dpr = (wx.getSystemInfoSync().pixelRatio) || 2
      node.width = width * dpr
      node.height = height * dpr
      const ctx = node.getContext('2d')
      ctx.scale(dpr, dpr)
      this.canvas = node
      this.ctx = ctx
      this.canvasW = width
      this.canvasH = height
      // ★ 竞态兜底（2026-11-20）：fetchStage 快照 / slide 帧可能先于 canvas 就绪到达，
      // loadPageImage 在 this.canvas 为空时会静默跳过（底图加载被丢弃，教师不翻页就永久白底）。
      // 就绪后补一次底图加载：loadPageImage 内部按 resourceId 分流教师-pc/mp 链路，
      // 同页去重条件是 bgKey===key && img——img 为 null 时会重新走加载，无重复请求副作用。
      this.loadPageImage()
      this.redrawStage()
    })
  },

  /** 全量重绘：底图（教师-mp 课件页）→ PC 板书层 → 批注层；主画布与全屏画布同步 */
  redrawStage() {
    if (this.ctx && this.canvasW) this.paintTo(this.ctx, this.canvasW, this.canvasH)
    if (this.fullCtx && this.fullW) this.paintTo(this.fullCtx, this.fullW, this.fullH)
  },

  /** 全量绘制核心（参数化目标画布）：白底 → 底图 → PC 板书层 → 批注层 */
  paintTo(ctx, w, h) {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    const st = this.stage || {}
    // 底图按目标画布 contain 重算（2026-11-20 全屏横屏适配）：主画布与全屏画布各自放大适配，
    // 不再复用主画布的 imgRect（否则全屏画布上底图不放大）
    let baseRect = null
    if (st.img && st.imgSize) {
      baseRect = this.fitContain(st.imgSize.iw, st.imgSize.ih, w, h)
      try { ctx.drawImage(st.img, baseRect.x, baseRect.y, baseRect.w, baseRect.h) } catch (e) { /* 底图失效降级白底 */ }
    } else if (st.img && st.imgRect) {
      baseRect = st.imgRect   // 无原始尺寸（旧数据兜底）：沿用主画布 rect
      try { ctx.drawImage(st.img, baseRect.x, baseRect.y, baseRect.w, baseRect.h) } catch (e) { /* 底图失效降级白底 */ }
    }
    // PC 板书层（教师-pc slide/stroke，坐标相对整画布）
    ;(st.strokes || []).forEach((s) => this.paintStroke(ctx, w, h, s))
    // 批注层（教师-mp annotation，坐标相对底图区域）
    ;(st.ann || []).forEach((s) => this.paintStroke(ctx, w, h, s, baseRect || { x: 0, y: 0, w: w, h: h }))
  },

  /** contain 适配（等比缩放居中）：底图在任意目标画布上的绘制区域 */
  fitContain(iw, ih, w, h) {
    const scale = Math.min(w / (iw || 1), h / (ih || 1))
    const rw = iw * scale
    const rh = ih * scale
    return { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh }
  },

  /** 画一笔（polyline；圆头圆拐），参数化目标画布。rect：坐标映射区域，默认整画布 */
  paintStroke(ctx, w, h, s, rect) {
    if (!ctx || !s || !s.points || s.points.length < 1) return
    const r = rect || { x: 0, y: 0, w: w, h: h }
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    s.points.forEach((p, i) => {
      const x = r.x + Math.max(0, Math.min(1, p.x)) * r.w
      const y = r.y + Math.max(0, Math.min(1, p.y)) * r.h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    if (s.points.length === 1) {
      // 单点（点按）：画圆点
      const x = r.x + Math.max(0, Math.min(1, s.points[0].x)) * r.w
      const y = r.y + Math.max(0, Math.min(1, s.points[0].y)) * r.h
      ctx.arc(x, y, s.width / 2, 0, Math.PI * 2)
      ctx.fillStyle = s.color
      ctx.fill()
    }
    ctx.stroke()
  },

  /** 增量画一笔（主画布 + 全屏画布同步；ctx 未就绪时跳过——帧数据已缓存，重绘时补齐） */
  drawIncremental(s, rect) {
    if (!s) return
    if (this.ctx && this.canvasW) this.paintStroke(this.ctx, this.canvasW, this.canvasH, s, rect)
    if (this.fullCtx && this.fullW) {
      // 全屏（横屏）画布批注按其自身尺寸重算底图区域，与主画布 rect 不同
      const frect = (rect && this.stage && this.stage.imgSize)
        ? this.fitContain(this.stage.imgSize.iw, this.stage.imgSize.ih, this.fullW, this.fullH)
        : rect
      this.paintStroke(this.fullCtx, this.fullW, this.fullH, s, frect)
    }
  },

  /** 增量画一笔批注（当前底图区域） */
  drawAnn(stroke) {
    if (!this.stage) return
    this.drawIncremental(stroke, this.stage.imgRect || null)
  },

  // ===== 画板全屏（2026-11-18）=====

  /** 进入/退出全屏：全屏覆盖层含独立 canvas，进入后横屏（与移动端横向全屏一致）并全量重绘 */
  toggleStageFull() {
    const next = !this.data.stageFull
    this.setData({ stageFull: next })
    if (!next) {
      // 退出全屏：释放全屏画布引用，增量帧不再写它；恢复竖屏
      this.fullCanvas = null
      this.fullCtx = null
      this.fullW = 0
      this.fullH = 0
      this.setPageOrientation('portrait')
      return
    }
    // 等覆盖层与 canvas 节点渲染完成后初始化（onResize 会因旋转让 initFullCanvas 重跑）
    this.setPageOrientation('landscape')
    setTimeout(() => this.initFullCanvas(), 150)
  },

  /** 页面方向切换（2026-11-20 全屏横屏）：基础库 2.15+ 支持，失败静默降级为竖屏全屏覆盖层 */
  setPageOrientation(orientation) {
    try {
      if (wx.setPageOrientation) {
        wx.setPageOrientation({ orientation, fail: () => { /* 低版本基础库：保持竖屏全屏 */ } })
      }
    } catch (e) { /* 兜底：不影响全屏覆盖层本身 */ }
  },

  /** 横竖屏切换回调：全屏态下画布尺寸随屏幕旋转变化，重初始化全屏画布并全量重绘 */
  onResize() {
    if (this.data.stageFull) {
      this.fullCanvas = null
      this.fullCtx = null
      this.fullW = 0
      this.fullH = 0
      setTimeout(() => this.initFullCanvas(), 200)
    }
  },

  /** 全屏 canvas 2d 初始化（与主画布同款：尺寸 × dpr），就绪后全量重绘补齐内容 */
  initFullCanvas() {
    if (!this.data.stageFull) return
    const q = wx.createSelectorQuery().in(this)
    q.select('#stageCanvasFull').fields({ node: true, size: true }).exec((res) => {
      if (!this.data.stageFull) return
      if (!res || !res[0] || !res[0].node || !res[0].width) {
        // 节点未就绪，稍后重试一次
        if (!this.fullCanvasRetry) {
          this.fullCanvasRetry = setTimeout(() => { this.fullCanvasRetry = null; this.initFullCanvas() }, 300)
        }
        return
      }
      this.fullCanvasRetry && (clearTimeout(this.fullCanvasRetry), this.fullCanvasRetry = null)
      const node = res[0].node
      const width = res[0].width
      const height = res[0].height
      const dpr = (wx.getSystemInfoSync().pixelRatio) || 2
      node.width = width * dpr
      node.height = height * dpr
      const ctx = node.getContext('2d')
      ctx.scale(dpr, dpr)
      this.fullCanvas = node
      this.fullCtx = ctx
      this.fullW = width
      this.fullH = height
      this.redrawStage()
    })
  },

  // ===== 轮询生命周期 =====

  startTimers() {
    if (this.stateTimer) return
    this.stateTimer = setInterval(() => this.refreshState(), STATE_POLL)
  },

  stopTimers() {
    if (this.stateTimer) { clearInterval(this.stateTimer); this.stateTimer = null }
    if (this.rosterTimer) { clearInterval(this.rosterTimer); this.rosterTimer = null }
  },

  /** 签到状态 + 当前测试（红点与在线人数的数据源） */
  async refreshState() {
    try {
      const st = await api.classroom.signinState(this.data.sessionId)
      const task = st.signinTask || null
      const signed = !!st.signed
      // 签到红点：任务进行中 + 我未签 + 未过期
      const notExpired = task && toTs(task.expireAt) > Date.now()
      this.setData({
        signed,
        signedTime: st.myAttendance ? hmOf(st.myAttendance.sign_time) : '',
        signinDot: !!(task && !signed && notExpired),
        'current.signed': st.signedCount || 0,
        'current.should': st.shouldCount || 0,
        // onlineCount 仅在线时才覆盖（旧版后端无该字段时保留 WS/上次值）
        ...(typeof st.onlineCount === 'number' ? { 'current.online': st.onlineCount } : {})
      })
    } catch (e) { /* 轮询失败静默 */ }
    try {
      const q = await api.classroom.quizCurrent(this.data.sessionId)
      // 测试红点：有进行中的测试 + 未提交 + 尚未首次查看（看过一次即消，wx 本地记忆）
      const seen = (wx.getStorageSync('quiz-seen-' + q.quizId) || false)
      const dot = !!(q.quizId && q.active && !q.submitted && !seen)
      this.setData({ quizDot: dot, quiz: q })
    } catch (e) { /* 轮询失败静默 */ }
  },

  // ===== 表 3-13 进入课堂 =====

  async enterClass() {
    try {
      // 我的 userId（聊天 mine 判定：实时帧无 mine 字段，前端按 senderId 数值对比）。
      // getMe 在 auth 命名空间下；★ 必须放在 try 内——api.getMe 误用会同步抛 TypeError，
      // async 调用无 await 时异常被静默吞掉，导致 enterStu 永不执行、页面数据全空（2026-11-20 修复）
      api.auth.getMe().then((me) => { this.myUserId = me && (me.userId || (me.data && me.data.userId)) || null }).catch(() => {})
      const s = await api.classroom.enterStu(this.data.sessionId)
      if (s && s.withinEntryWindow === false) {
        this.setData({ loading: false })
        wx.showModal({
          title: '当前不在上课时间',
          content: s.windowHint || '课堂进入窗口为课前 30 分钟至课后 10 分钟，请在上课时间再进入。',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      const ct = s.class_time || ''
      const week = ct ? (Number(ct.slice(5, 7)) + '月' + Number(ct.slice(8, 10)) + '日') : ''
      // 等待态（2026-11-18 权限口径对齐）：按钮出现即可进入——教师已建课未开始(waiting)
      // 时正常显示头部卡并停留在课堂页等待实时帧，不提示错误
      if (s.status === 'waiting') {
        wx.showToast({ title: '教师即将开课，正在等待', icon: 'none', duration: 2500 })
      }
      const cur = this.data.current
      this.setData({
        loading: false,
        current: {
          course: s.course_name || '',
          week: week,
          teacher: s.teacher_name || '',
          room: s.classroom_name || '教室待定',
          section: (s.period_no || '') + ' 节',
          stage: STAGE_TEXT[s.status] || (s.status || ''),
          signed: cur.signed,
          should: cur.should,
          online: cur.online
        }
      })
      // 实时语音（2026-11-20）：进课堂后自动收听教师语音（503/组件未部署 → 「仅同步课件」降级）
      this.initAudio()
    } catch (e) {
      // request 层已 toast（未选课 403 / 课堂不存在 404 等）
      this.setData({ loading: false })
    }
  },

  // ===== 实时语音（2026-11-20，LiveKit RTMP 桥）=====
  // 下行：live-player 拉课堂合成音（RTMP over TCP，听教师/房间语音）；
  // 上行：live-pusher RTMP 推麦克风（经 LiveKit Ingress 进房间，教师可在参与者面板禁言）；
  // 禁言感知：教师端 mic 接口广播 audio-mic WS 帧（MP 端无 LiveKit 连接，靠信令同步状态）。

  /** 进课堂后连接语音下行；失败静默降级为「仅同步课件」，不影响课堂其他功能 */
  async initAudio() {
    this.setData({ audioState: 'loading' })
    try {
      const r = await api.classroom.mpAudioDownlink(this.data.sessionId)
      const d = (r && (r.data || r)) || {}
      if (!d.pullUrl) throw new Error('empty pullUrl')
      this.setData({ audioPullUrl: d.pullUrl, audioState: 'listening' })
    } catch (e) {
      // 503（音频服务未配置/桥接组件未部署）或其他：一律「仅同步课件」，不打断课堂
      this.setData({ audioState: 'offline', audioPullUrl: '' })
    }
  },

  /** 开麦/闭麦：开麦走 uplink 接口取推流地址（组件挂载后自动推）；被禁言时按钮置灰 */
  async toggleMic() {
    if (this.data.audioMuted) {
      wx.showToast({ title: '已被教师关闭麦克风', icon: 'none' })
      return
    }
    if (this.data.audioState !== 'listening') {
      wx.showToast({ title: '语音未连接，仅同步课件', icon: 'none' })
      return
    }
    if (this.data.audioMicOn) {
      // 闭麦：卸载 live-pusher 停止推流（释放麦克风占用）
      this.setData({ audioMicOn: false, audioPushUrl: '' })
      return
    }
    try {
      const r = await api.classroom.mpAudioUplink(this.data.sessionId)
      const d = (r && (r.data || r)) || {}
      if (!d.pushUrl) throw new Error('empty pushUrl')
      this.setData({ audioPushUrl: d.pushUrl, audioMicOn: true })
    } catch (e) {
      wx.showToast({ title: '开麦失败，请稍后重试', icon: 'none' })
    }
  },

  /** 教师禁言/恢复信令（audio-mic 帧）：按 studentId 匹配本人 → 更新按钮态 */
  onAudioMicFrame(payload) {
    if (!payload || this.myUserId == null) return
    if (Number(payload.studentId) !== Number(this.myUserId)) return
    const enabled = !!payload.enabled
    if (!enabled) {
      // 立即闭麦：卸载推流组件
      this.setData({ audioMuted: true, audioMicOn: false, audioPushUrl: '' })
      wx.showToast({ title: '教师已关闭你的麦克风', icon: 'none' })
    } else {
      this.setData({ audioMuted: false })
      wx.showToast({ title: '教师已允许你发言', icon: 'none' })
    }
  },

  /** live-player 状态回调：连接失败 → 降级提示（编码见 live-player 文档 statechange） */
  onAudioPlayerState(e) {
    const code = e && e.detail ? e.detail.code : 0
    if (code === -2301 || code === 2102) {
      // 拉流断开/错误：降级为「仅同步课件」，不打断课堂
      this.setData({ audioState: 'offline', audioPullUrl: '' })
    }
  },

  /** live-pusher 状态回调：推流失败（含授权拒绝）→ 复位按钮并提示 */
  onAudioPusherState(e) {
    const code = e && e.detail ? e.detail.code : 0
    if (code === -3007 || code === -3001) {
      // 麦克风授权拒绝 / 推流失败：复位开麦态
      this.setData({ audioMicOn: false, audioPushUrl: '' })
      wx.showToast({ title: '麦克风不可用或权限未授予', icon: 'none' })
    }
  },

  // ===== 导航 =====

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    // 随堂测试红点：第一次点击后消失（本地记忆该 quizId 已查看）
    if (tab === 'quiz') {
      const q = this.data.quiz
      if (q.quizId) wx.setStorageSync('quiz-seen-' + q.quizId, true)
      this.setData({ tab, quizDot: false })
    } else if (tab === 'chat') {
      // 进入聊天 tab：清红点 + 滚到最新消息
      this.setData({ tab, chatDot: false })
      const messages = this.data.messages
      if (messages.length) {
        this.setData({ chatScrollInto: 'msg-' + messages[messages.length - 1].messageId })
      }
    } else {
      this.setData({ tab })
    }
  },

  // ===== 签到（表 3-14） =====

  /** 点签到按钮：无任务 toast；有任务弹方式面板 */
  async tapSignin() {
    if (this.data.signed) {
      wx.showToast({ title: '你已完成本次签到（' + (this.data.signedTime || '') + '）', icon: 'none' })
      return
    }
    let st
    try {
      st = await api.classroom.signinState(this.data.sessionId)
    } catch (e) {
      // request 层已 toast
      return
    }
    const task = st.signinTask
    if (!task || toTs(task.expireAt) <= Date.now()) {
      wx.showToast({ title: '教师还未发布任何签到', icon: 'none' })
      return
    }
    let types = []
    try { types = JSON.parse(task.signTypes || '[]') || [] } catch (e) { types = [] }
    const ways = types.filter((t) => SIGN_WAYS[t]).map((t) => ({ key: t, flow: WAY_FLOW[t], label: SIGN_WAYS[t] }))
    if (!ways.length) {
      wx.showToast({ title: '教师还未发布任何签到', icon: 'none' })
      return
    }
    this.setData({ signinPanel: true, signinWays: ways, codeInput: '' })
  },

  closeSigninPanel() {
    this.setData({ signinPanel: false, gestureShow: false, gestureDots: [] })
  },

  /** 选中签到方式 → 对应子流程（flow 决定交互，key 用教师原始命名提交） */
  chooseWay(e) {
    const key = e.currentTarget.dataset.key
    const flow = WAY_FLOW[key] || key
    if (flow === 'numeric') {
      // 课程码：弹可编辑输入框（基础库 2.17.1+）
      wx.showModal({
        title: '课程码签到',
        editable: true,
        placeholderText: '输入教师公布的课程码',
        confirmColor: '#0d9488',
        success: (res) => {
          if (res.confirm) this.doSign(key, { value: (res.content || '').trim() })
        }
      })
    } else if (flow === 'qr') {
      wx.scanCode({
        success: (res) => this.doSign(key, { value: res.result || '' }),
        fail: () => { /* 用户取消扫码 */ }
      })
    } else if (flow === 'location') {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => this.doSign(key, {
          meta: JSON.stringify({ lat: res.latitude, lng: res.longitude })
        }),
        fail: () => wx.showToast({ title: '获取定位失败，请检查定位权限', icon: 'none' })
      })
    } else if (flow === 'photo') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0]
          this.doSign(key, { meta: 'photo:' + (f ? f.tempFilePath : '') })
        },
        fail: () => { /* 用户取消拍照 */ }
      })
    } else if (flow === 'gesture') {
      this.setData({ gestureShow: true, gestureDots: [] })
    }
  },

  /** 统一提交签到（表 3-14） */
  async doSign(signType, extra) {
    try {
      const res = await api.classroom.signin(this.data.sessionId, Object.assign({
        signType: signType, value: '', meta: ''
      }, extra || {}))
      this.setData({ signinPanel: false, gestureShow: false, gestureDots: [], signed: true, signedTime: hmOf(res.signTime) })
      wx.showToast({ title: res.message || '签到成功', icon: 'success' })
      this.refreshState()
    } catch (e) {
      // request 层已 toast（口令错误 422 / 已签过 409 等）
    }
  },

  // ===== 手势签到：九宫格点位序列（教师现场展示手势，学生按序点亮） =====

  tapGestureDot(e) {
    const n = Number(e.currentTarget.dataset.n)
    if (!n || this.data.gestureDots.indexOf(n) >= 0) return
    this.setData({ gestureDots: this.data.gestureDots.concat([n]) })
  },

  undoGesture() { this.setData({ gestureDots: this.data.gestureDots.slice(0, -1) }) },
  clearGesture() { this.setData({ gestureDots: [] }) },

  submitGesture() {
    if (!this.data.gestureDots.length) {
      wx.showToast({ title: '请先按教师展示的手势点亮点位', icon: 'none' })
      return
    }
    this.doSign('gesture', { meta: this.data.gestureDots.join('-') })
  },

  // ===== 花名册（学生只读；10s 轮询自动刷新） =====

  async toggleRoster() {
    const show = !this.data.rosterShow
    this.setData({ rosterShow: show })
    if (show) {
      this.loadRoster()
      if (!this.rosterTimer) {
        this.rosterTimer = setInterval(() => {
          if (this.data.rosterShow) this.loadRoster()
        }, ROSTER_POLL)
      }
    } else if (this.rosterTimer) {
      clearInterval(this.rosterTimer)
      this.rosterTimer = null
    }
  },

  async loadRoster() {
    try {
      const res = await api.classroom.stuRoster(this.data.sessionId, 1, 100)
      this.setData({ roster: res.list || [], rosterTotal: res.total || 0 })
    } catch (e) {
      // request 层已 toast（未选课 403 等）
    }
  },

  // ===== 随堂测试 =====

  /** 开始测试：跳作答卷（提交后跳答题情况） */
  goQuiz() {
    const q = this.data.quiz
    if (!q.quizId) return
    wx.navigateTo({ url: '/pages/live-quiz-answer/live-quiz-answer?quizId=' + q.quizId + '&courseId=' + (q.courseId || '') })
  },

  /** 已提交过 → 看本次答题情况 */
  goQuizResult() {
    wx.navigateTo({ url: '/pages/live-quiz-result/live-quiz-result?quizId=' + this.data.quiz.quizId + '&courseId=' + (this.data.quiz.courseId || '') })
  },

  /** 历史测试列表（该课程全部发布记录，新→旧） */
  goQuizHistory() {
    const q = this.data.quiz
    const courseId = q.courseId
    if (!courseId) {
      wx.showToast({ title: '课程信息加载中，请稍候再试', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/live-quiz-history/live-quiz-history?courseId=' + courseId
        + '&courseName=' + encodeURIComponent(this.data.current.course || '')
    })
  }
})
