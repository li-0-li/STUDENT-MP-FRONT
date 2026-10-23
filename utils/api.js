/**
 * 接口契约层（学生端）—— 后端为 itap-server（M-B+M-D 合并，8080 单服务）。
 * 路径与《05-接口设计文档.docx》第 2/3 章逐条对应：
 *   登录（表 2-1）+ 课程资源（表 3-1~3-4，M-B）+ 作业/课表/课堂/消息/客服/个人中心/学情/AI（M-D）。
 * 教师/管理端接口（表 4-x/5-1）不在学生端使用。
 */
const request = require('./request')

/* ===== 第 2 章 公共接口 ===== */
const authApi = {
  /** 表 2-1 用户登录：POST /api/v1/auth/login（clientType: 'mp_student'） */
  login: (data) => request.post('/v1/auth/login', Object.assign({ clientType: 'mp_student' }, data)),
  /** 表 2-14 当前用户信息：GET /api/v1/users/me */
  getMe: () => request.get('/v1/users/me'),
  /* ===== M-A 认证服务（8081，request.js 自动路由）===== */
  /** 发送验证码：POST /api/v1/auth/captcha/send（target: 手机号/邮箱，channel: phone/email，scene: register/forgot_pwd） */
  sendCaptcha: (data) => request.post('/v1/auth/captcha/send', data),
  /** 用户注册：POST /api/v1/auth/register（验证码校验 + 绑定学生角色），返回 { userId } */
  register: (data) => request.post('/v1/auth/register', data),
  /** 重置密码：POST /api/v1/auth/password/reset（target + channel + code + newPassword） */
  resetPassword: (data) => request.post('/v1/auth/password/reset', data)
}

/* ===== M-B 课程资源（表 3-1~3-4） ===== */
const courseApi = {
  /** 表 3-1 课程列表（学生返回「我学的课」）：GET /api/v1/courses */
  listMine: (params) => request.get('/v1/courses', params),
  /** 表 3-2 课程详情（课程信息 + 教学周目录 + enrolled）：GET /api/v1/courses/{courseId} */
  detail: (courseId) => request.get('/v1/courses/' + courseId),
  /** 表 3-3 学生加课：POST /api/v1/courses/{courseId}/enroll（课程码场景 courseId 传 0） */
  enroll: (courseId, data) => request.post('/v1/courses/' + courseId + '/enroll', data),
  /** 学生退出课程：DELETE /api/v1/courses/{courseId}/enroll */
  withdraw: (courseId) => request.del('/v1/courses/' + courseId + '/enroll'),
  /** 课程上课安排：GET /api/v1/courses/{courseId}/schedules */
  schedules: (courseId) => request.get('/v1/courses/' + courseId + '/schedules'),
  /** 加课前课程搜索：GET /api/v1/courses/search（courseCode 精确 / keyword 模糊，学生专用） */
  search: (params) => request.get('/v1/courses/search', params),
  /** 公开课列表（学生）：GET /api/v1/courses/public（is_public=1 且已发布，带 enrolled 标记） */
  publicCourses: (params) => request.get('/v1/courses/public', params),
  /** 表 3-4 资源列表：GET /api/v1/courses/{courseId}/resources（weekNum/resourceType 筛选） */
  listResources: (courseId, params) => request.get('/v1/courses/' + courseId + '/resources', params)
}

/* ===== M-D 作业与提交（表 3-5/3-6/3-7/3-21） ===== */
const homeworkApi = {
  /** 表 3-5 作业列表：GET /api/v1/assignments（courseId/status/keyword/page/pageSize） */
  list: (params) => request.get('/v1/assignments', params),
  /** 作业试卷题目（作答视图，不含答案/解析）：GET /api/v1/assignments/{assignmentId}/questions */
  questions: (assignmentId) => request.get('/v1/assignments/' + assignmentId + '/questions'),
  /** 表 3-6 提交作业：POST /api/v1/assignments/{assignmentId}/submissions */
  submit: (assignmentId, data) => request.post('/v1/assignments/' + assignmentId + '/submissions', data),
  /** 表 3-7 作业申诉：POST /api/v1/submissions/{submissionId}/appeal */
  appeal: (submissionId, data) => request.post('/v1/submissions/' + submissionId + '/appeal', data),
  /** 表 3-21 退回重交：POST /api/v1/submissions/{submissionId}/resubmit */
  resubmit: (submissionId, data) => request.post('/v1/submissions/' + submissionId + '/resubmit', data),
  /** 提交详情（作答回看）：GET /api/v1/submissions/{submissionId}（逐题作答/答案/对错/评语） */
  detail: (submissionId) => request.get('/v1/submissions/' + submissionId),
  /** 错题本（表 3-8 关联）：GET /api/v1/wrong-records */
  wrongRecords: (params) => request.get('/v1/wrong-records', params),
  /**
   * 错题本同步：POST /api/v1/wrong-records/sync
   * 把当前学生「已批改提交中答错、但漏记」的客观题补进错题本。
   * 只补缺失、不改已存在的行，可重复调用（幂等）。
   */
  syncWrongRecords: () => request.post('/v1/wrong-records/sync'),
  /** 删除一道错题（逻辑删除，后端置 deleted=1） */
  deleteWrongRecord: (errorId) => request.del('/v1/wrong-records/' + errorId),
  /** 重做一道错题：提交作答，后端判分并写回错题记录，返回判分结果 */
  redoWrongRecord: (errorId, answer) =>
    request.post('/v1/wrong-records/' + errorId + '/redo', { answer: answer })
}

/* ===== 课表（表 3-12，学生专用，走课程模块） ===== */
const scheduleApi = {
  /** GET /api/v1/courses/my-schedule：当前周次信息 + 全量排课 */
  mine: () => request.get('/v1/courses/my-schedule')
}

/* ===== M-D 实验报告（表 3-17/3-18/3-22） ===== */
const experimentApi = {
  /** 实验任务列表：GET /api/v1/experiments?courseId= */
  list: (courseId) => request.get('/v1/experiments', courseId ? { courseId } : {}),
  /** 表 3-17 提交实验报告：POST /api/v1/experiments/{taskId}/submissions */
  submit: (taskId, data) => request.post('/v1/experiments/' + taskId + '/submissions', data),
  /** 表 3-18 报告详情：GET /api/v1/experiment-submissions/{submissionId} */
  detail: (submissionId) => request.get('/v1/experiment-submissions/' + submissionId),
  /** 表 3-22 报告下载：GET /api/v1/experiment-submissions/{submissionId}/report */
  report: (submissionId) => request.get('/v1/experiment-submissions/' + submissionId + '/report')
}

/* ===== M-D 课堂参与（表 3-13~3-16） ===== */
const classroomApi = {
  /** 表 3-13 进入课堂：POST /api/v1/sessions/{sessionId}/enter */
  enter: (sessionId) => request.post('/v1/sessions/' + sessionId + '/enter'),
  /** 签到状态：GET /api/v1/sessions/{sessionId}/signin */
  signinState: (sessionId) => request.get('/v1/sessions/' + sessionId + '/signin'),
  /** 表 3-14 课堂签到：POST /api/v1/sessions/{sessionId}/signin */
  signin: (sessionId, data) => request.post('/v1/sessions/' + sessionId + '/signin', data),
  /** 表 3-15 课堂互动参与：POST /api/v1/sessions/{sessionId}/interactions */
  interact: (sessionId, data) => request.post('/v1/sessions/' + sessionId + '/interactions', data),
  /** 表 3-16 课堂聊天消息：GET/POST /api/v1/sessions/{sessionId}/messages */
  messages: (sessionId, params) => request.get('/v1/sessions/' + sessionId + '/messages', params),
  sendMessage: (sessionId, data) => request.post('/v1/sessions/' + sessionId + '/messages', data)
}

/* ===== 消息接口形状兼容层（M-E 会话/消息 + M-A 通知）=====
 * merged 后端的 GET /conversations、/conversations/{id}/messages、GET /notifications
 * 返回 {list,total,page,pageSize} 包装 + 驼峰字段，而学生端契约（表 2-10/2-12/2-13）
 * 是 snake_case 裸数组。此处统一归一为契约形状，后端对齐契约后可整段删除。
 * 注意：M-E 消息记录按 send_time 正序返回，页面按「倒序返回、正序展示」消费，这里翻成倒序。 */

/** PageResult 包装 → 裸数组（本来就是数组则透传） */
function unwrapMsgList(res) {
  return Array.isArray(res) ? res : (res && res.list) || []
}

/** 表 2-10 会话条目：驼峰 → snake_case（direct_key/created_by 供前端解析私聊对方） */
function convCompat(c) {
  return {
    conversation_id: c.conversationId,
    conv_type: c.convType,
    title: c.title,
    class_name: c.className,
    direct_key: c.directKey,
    created_by: c.createdBy,
    last_message: c.lastMessage,
    // M-E 列表 lastMessage 常为 null，退回 updateTime 保证时间列不空
    last_message_time: c.lastMessageTime || c.updateTime,
    unread_count: c.unreadCount || 0
  }
}

/** 表 2-12 消息记录：驼峰 → snake_case */
function msgCompat(m) {
  return {
    message_id: m.messageId,
    sender_id: m.senderId,
    sender_name: m.senderName,
    content: m.content,
    send_time: m.sendTime
  }
}

/** 表 2-13 通知条目：驼峰 → snake_case */
function noticeCompat(n) {
  return {
    notice_id: n.noticeId,
    title: n.title,
    content: n.content,
    create_time: n.createTime,
    is_read: n.isRead
  }
}

/* ===== M-D 消息通知（表 2-10~2-13/2-17） ===== */
const messageApi = {
  /** 会话列表：GET /api/v1/conversations（形状兼容：PageResult 驼峰 → snake_case 数组） */
  conversations: () => request.get('/v1/conversations', { page: 1, pageSize: 50 })
    .then((r) => unwrapMsgList(r).map(convCompat)),
  /** 会话消息记录：GET /api/v1/conversations/{conversationId}/messages（兼容层翻为倒序，页面正序展示） */
  messages: (conversationId, params) => request.get('/v1/conversations/' + conversationId + '/messages', params)
    .then((r) => unwrapMsgList(r).map(msgCompat).reverse()),
  /** 发送消息：POST /api/v1/conversations/{conversationId}/messages */
  send: (conversationId, data) => request.post('/v1/conversations/' + conversationId + '/messages', data),
  /** 站内通知列表：GET /api/v1/notifications（形状兼容：PageResult 驼峰 → snake_case 数组） */
  notifications: () => request.get('/v1/notifications', { page: 1, pageSize: 50 })
    .then((r) => unwrapMsgList(r).map(noticeCompat)),
  /** 未读数：GET /api/v1/notifications/unread-count（兼容层归一为 {total}，后端可能返回裸数字） */
  unreadCount: () => request.get('/v1/notifications/unread-count')
    .then((n) => ({ total: typeof n === 'number' ? n : (n && n.total) || 0 })),
  /** 已读标记：POST /api/v1/notifications/read */
  markRead: (data) => request.post('/v1/notifications/read', data),
  /** 新增会话（发起一对一会话）：POST /api/v1/conversations */
  create: (data) => request.post('/v1/conversations', data),
  /** 删除通知/会话：POST /api/v1/messages/delete（targetType: notice/conversation） */
  remove: (data) => request.post('/v1/messages/delete', data)
}

/* ===== M-D 客服（表 3-20/3-23~3-25） ===== */
const supportApi = {
  /** 表 3-20 客服咨询：POST /api/v1/support/consult */
  consult: (data) => request.post('/v1/support/consult', data),
  /** 表 3-23 客服会话列表：GET /api/v1/support/tickets */
  tickets: () => request.get('/v1/support/tickets'),
  /** 表 3-24 客服消息查询：GET /api/v1/support/tickets/{ticketId}/messages */
  messages: (ticketId) => request.get('/v1/support/tickets/' + ticketId + '/messages'),
  /** 表 3-25 发送客服消息：POST /api/v1/support/tickets/{ticketId}/messages */
  sendMessage: (ticketId, data) => request.post('/v1/support/tickets/' + ticketId + '/messages', data)
}

/* ===== M-D 个人中心（表 2-6/2-7/2-8/2-9/2-16） ===== */
const userApi = {
  /** 表 2-14 获取当前用户信息 */
  me: () => request.get('/v1/users/me'),
  /** 表 2-6 修改密码：PUT /api/v1/users/me/password */
  changePassword: (data) => request.put('/v1/users/me/password', data),
  /** 表 2-7 修改个人资料：PUT /api/v1/users/me/profile */
  updateProfile: (data) => request.put('/v1/users/me/profile', data),
  /** 表 2-8 上传头像：POST /api/v1/users/me/avatar（multipart，字段名 avatarfile） */
  uploadAvatar: (filePath) => request.upload('/v1/users/me/avatar', filePath, 'avatarfile'),
  /** 表 2-9 注销账号：POST /api/v1/users/me/cancel */
  cancel: (data) => request.post('/v1/users/me/cancel', data),
  /** 表 2-16 通知偏好设置：PUT /api/v1/users/me/notify-pref */
  notifyPref: (data) => request.put('/v1/users/me/notify-pref', data)
}

/* ===== M-D 学情与 AI（表 3-9/3-10/3-11/3-19/3-26） ===== */
const aiApi = {
  /** 表 3-9 课程 AI 答疑：POST /api/v1/qa/ask */
  ask: (data) => request.post('/v1/qa/ask', data),
  /** 表 3-10 答疑反馈：POST /api/v1/qa/{qaId}/feedback */
  feedback: (qaId, data) => request.post('/v1/qa/' + qaId + '/feedback', data),
  /** 表 3-11 学情画像（雷达图数据）：GET /api/v1/profiles/me?courseId= */
  profile: (courseId) => request.get('/v1/profiles/me', { courseId }),
  /**
   * 我的课程学习进度：GET /api/v1/profiles/me/courses
   * 返回每门课的 未开始 / 进行中 / 已完成 三态、作业完成率、掌握度，以及三态汇总。
   */
  myCourseProgress: () => request.get('/v1/profiles/me/courses'),
  /** 表 3-19 薄弱点练习推荐：GET /api/v1/practice/recommend?courseId= */
  recommend: (courseId) => request.get('/v1/practice/recommend', { courseId }),
  /** 拉取练习题目内容（推荐返回的题号，不含答案）：GET /api/v1/practice/questions?ids=1,2,3 */
  questions: (ids) => request.get('/v1/practice/questions', { ids: ids.join(',') }),
  /** 表 3-26 提交练习作答：POST /api/v1/practice/submit */
  submitPractice: (data) => request.post('/v1/practice/submit', data),
  /** 学习预警：GET /api/v1/alerts */
  alerts: () => request.get('/v1/alerts')
}

/* ===== 开发期临时：测试令牌（正式登录接口由 M-A 交付后删除） ===== */
const devApi = {
  /** dev-only 签发测试令牌：POST /api/v1/dev/token */
  token: (data) => request.post('/v1/dev/token', data)
}

module.exports = {
  auth: authApi,
  course: courseApi,
  homework: homeworkApi,
  schedule: scheduleApi,
  experiment: experimentApi,
  classroom: classroomApi,
  message: messageApi,
  support: supportApi,
  user: userApi,
  ai: aiApi,
  dev: devApi
}
