// 周→课次聚合共享模块（2026-11-10 课程详情改版）
// 形态：「第 N 周」大卡片 → 课次小卡片 → 资源小卡片（作业📝/实验🧪/文件📄 按课次归属）。
// 归属规则：作业/实验/资源按 scheduleId 挂课次卡片下；scheduleId 为 NULL 的历史数据
//   按 weekNum 挂周级「本周共用」（与教师端口径一致，不丢数据）；两者皆无进「未归周」组。
//   导学视频（detail.introVideo）不属于课次资源，不参与挂载。
const api = require('./api')
const { FILE_BASE_URL } = require('./config')

/** 截止/提交时间 → 「YYYY-MM-DD」 */
function fmtDate(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 10) : '—'
}

/** 上课时间 → 「MM-DD HH:mm」 */
function fmtClassTime(iso) {
  if (!iso) return ''
  return String(iso).replace('T', ' ').slice(5, 16)
}

/** 字节 → B/KB/MB */
function fmtBytes(n) {
  n = Number(n) || 0
  if (n <= 0) return ''
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB'
  return (n / 1024 / 1024).toFixed(1) + 'MB'
}

// 资源形态图标（doc文档/video视频/image图片/table表格/quiz题库）
const FILE_ICONS = { doc: '📄', video: '🎬', image: '🖼️', table: '📊', quiz: '❓' }

// 作业条目 → 统一挂载项（状态口径与「我的作业」页一致）
function mapHomework(it) {
  const ms = it.myStatus
  const base = { kind: 'hw', id: it.assignmentId, scheduleId: it.scheduleId || null,
    weekNum: it.weekNum, icon: '📝', name: it.title || '未命名作业' }
  if (ms === 'graded' || ms === 'finished') {
    return Object.assign(base, {
      statusText: '已批改', badge: 'badge-success',
      meta: '得分：' + (it.myScore != null ? it.myScore : '—') + ' / ' + (it.totalScore || '—')
    })
  }
  if (ms === 'appealing') {
    return Object.assign(base, { statusText: '申诉处理中', badge: 'badge-error', meta: '截止：' + fmtDate(it.deadline) })
  }
  if (ms === 'returned') {
    return Object.assign(base, { statusText: '已退回 · 请重交', badge: 'badge-warning', meta: '截止：' + fmtDate(it.deadline) })
  }
  if (ms == null || ms === 'draft') {
    return Object.assign(base, { statusText: '待提交', badge: 'badge-warning', meta: '截止：' + fmtDate(it.deadline) })
  }
  return Object.assign(base, { statusText: '已提交 · 批改中', badge: 'badge-info', meta: '截止：' + fmtDate(it.deadline) })
}

// 实验条目 → 统一挂载项（接口返回下划线字段，状态口径与实验页一致）
function mapExperiment(t) {
  const sub = t.sub_status != null ? String(t.sub_status).toUpperCase() : null
  const base = { kind: 'exp', id: t.task_id, scheduleId: t.schedule_id || null,
    weekNum: t.week_num, icon: '🧪', name: t.title || '未命名实验' }
  if (sub === 'GRADED') {
    return Object.assign(base, {
      statusText: '已批阅' + (t.sub_score != null ? ' · ' + t.sub_score : ''), badge: 'badge-success',
      meta: '提交于 ' + fmtDate(t.submit_time)
    })
  }
  if (sub == null) {
    return Object.assign(base, { statusText: '待提交', badge: 'badge-warning', meta: '截止：' + fmtDate(t.deadline) })
  }
  return Object.assign(base, { statusText: '已提交 · 待批阅', badge: 'badge-info', meta: '提交于 ' + fmtDate(t.submit_time) })
}

// 文件资源条目 → 统一挂载项（fileUrl 相对路径拼 FILE_BASE_URL）
function mapResource(r) {
  const url = r.fileUrl ? (/^https?:\/\//.test(r.fileUrl) ? r.fileUrl : FILE_BASE_URL + r.fileUrl) : ''
  return {
    kind: 'file',
    id: r.resourceId,
    scheduleId: r.scheduleId || null,
    weekNum: r.weekNum,
    icon: FILE_ICONS[r.fileType] || '📄',
    name: r.fileName || '未命名资源',
    fileType: r.fileType || 'doc',
    url: url,
    meta: fmtBytes(r.fileSize)
  }
}

/** 课次卡片字段（wxml 展示用） */
function lessonView(l) {
  return {
    scheduleId: l.scheduleId,
    timeText: fmtClassTime(l.classTime),
    weekdayText: l.weekdayText || '',
    periodNo: l.periodNo || '',
    durationMin: l.durationMin || 0,
    classroomName: l.classroomName || '',
    classroomLocation: l.classroomLocation || '',
    statusText: l.status === 'ongoing' ? '进行中' : l.status === 'canceled' ? '已取消' : '正常',
    badge: l.status === 'canceled' ? 'badge-neutral' : (l.status === 'ongoing' ? 'badge-info' : '')
  }
}

/**
 * 组装周块：挂载项按 scheduleId→课次 / weekNum→本周共用 / 其余→孤儿 分桶后贴回。
 * 返回 { weeks: [{key, weekNum, title, label, lessons:[{...课次字段, items:[]}], common:{items}, commonCount}],
 *        termText, currentWeek, totalLessons }
 */
function buildWeekBlocks(wl, hwRes, expRes, rsRes) {
  const bySchedule = {}
  const byWeek = {}
  const orphan = { items: [] }
  function bucket(store, key) {
    if (!store[key]) store[key] = { items: [] }
    return store[key]
  }
  ;((hwRes && (hwRes.list || hwRes)) || []).forEach(function (h) {
    const m = mapHomework(h)
    if (m.scheduleId) bucket(bySchedule, m.scheduleId).items.push(m)
    else if (m.weekNum != null) bucket(byWeek, m.weekNum).items.push(m)
    else orphan.items.push(m)
  })
  ;((expRes && (expRes.list || expRes)) || []).forEach(function (t) {
    const m = mapExperiment(t)
    if (m.scheduleId) bucket(bySchedule, m.scheduleId).items.push(m)
    else if (m.weekNum != null) bucket(byWeek, m.weekNum).items.push(m)
    else orphan.items.push(m)
  })
  ;((rsRes && (rsRes.list || rsRes)) || []).forEach(function (r) {
    const m = mapResource(r)
    if (m.scheduleId) bucket(bySchedule, m.scheduleId).items.push(m)
    else if (m.weekNum != null) bucket(byWeek, m.weekNum).items.push(m)
    else orphan.items.push(m)
  })

  const blocks = ((wl && wl.weeks) || []).map(function (w, idx) {
    const lessons = (w.lessons || []).map(function (l) {
      const sb = bySchedule[l.scheduleId] || { items: [] }
      return Object.assign(lessonView(l), { items: sb.items })
    })
    const wb = w.weekNum != null ? (byWeek[w.weekNum] || null) : null
    const commonItems = wb ? wb.items : []
    const all = commonItems.concat.apply(commonItems, lessons.map(function (l) { return l.items }))
    return {
      key: 'w' + (w.weekNum == null ? 'na' : w.weekNum) + idx,
      weekNum: w.weekNum,
      label: w.weekNum != null ? '第 ' + w.weekNum + ' 周' : '未分周',
      lessons: lessons,
      common: { items: commonItems },
      itemCount: all.length
    }
  })

  if (orphan.items.length) {
    blocks.push({
      key: 'w-other', weekNum: null, label: '未归周',
      lessons: [], common: { items: orphan.items }, itemCount: orphan.items.length
    })
  }

  const termText = wl && wl.termStartDate
    ? '学期：' + (wl.termName || '') + ' · ' + String(wl.termStartDate).slice(0, 10) + ' 起第 1 周'
    : ''

  return {
    weeks: blocks,
    termText: termText,
    currentWeek: wl ? (wl.currentWeek || null) : null,
    totalLessons: blocks.reduce(function (n, w) { return n + w.lessons.length }, 0)
  }
}

/** 拉取周课次聚合并完成资源挂载（week-lessons 失败不整体抛错，返回空周结构） */
async function loadWeekMount(courseId) {
  const results = await Promise.all([
    api.course.weekLessons(courseId).catch(function () { return null }),
    api.homework.list({ courseId: courseId, page: 1, pageSize: 100 }).catch(function () { return null }),
    api.experiment.list(courseId).catch(function () { return [] }),
    api.course.listResources(courseId, { page: 1, pageSize: 100 }).catch(function () { return null })
  ])
  return buildWeekBlocks(results[0], results[1], results[2], results[3])
}

/** 挂载项点按分发：作业→提交页 / 实验→详情页 / 文件→按形态预览 */
function openItem(e) {
  const d = e.currentTarget.dataset
  if (d.kind === 'hw') {
    wx.navigateTo({ url: '/pages/submission/submission?id=' + d.id })
  } else if (d.kind === 'exp') {
    wx.navigateTo({ url: '/pages/experiment-detail/experiment-detail?taskId=' + d.id })
  } else if (d.url) {
    if (d.type === 'video' && wx.previewMedia) {
      wx.previewMedia({ sources: [{ url: d.url, type: 'video' }] })
    } else if (d.type === 'image') {
      wx.previewImage({ current: d.url, urls: [d.url] })
    } else {
      wx.showLoading({ title: '下载中…', mask: true })
      wx.downloadFile({
        url: d.url,
        success(res) {
          wx.hideLoading()
          wx.openDocument({ filePath: res.tempFilePath, showMenu: true,
            fail() { wx.showToast({ title: '该文件类型暂不支持预览', icon: 'none' }) } })
        },
        fail() {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        }
      })
    }
  }
}

module.exports = { loadWeekMount, buildWeekBlocks, openItem, fmtClassTime, FILE_ICONS }
