const { app, BrowserWindow, Menu, ipcMain, shell, Notification, dialog, Tray, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const { JsonCollection } = require('../server/db')
const { completionPatch } = require('../server/task-completion')
const gcal = require('../server/google-calendar')
const { LanSyncManager, getLocalIpAddresses, DEFAULT_PORT } = require('../server/lan-sync')
const { generateTasksDocx } = require('../server/docx-export')

const isDev = process.env.NODE_ENV === 'development'
const devTestInstance = isDev && ['host', 'client'].includes(process.env.TASKBOARD_DEVTEST_INSTANCE)
  ? process.env.TASKBOARD_DEVTEST_INSTANCE
  : null

if (devTestInstance) {
  app.setPath('userData', path.join(app.getPath('temp'), 'taskboard-devtest', devTestInstance))
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.taskboard.app')
}

const hasSingleInstanceLock = devTestInstance || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

// All "what day/time is it" logic for notifications is pinned to Vietnam
// time (Asia/Ho_Chi_Minh), regardless of the machine's system timezone.
const VN_TZ = 'Asia/Ho_Chi_Minh'
function vnTodayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function vnNowTimeStr() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).format(new Date())
}
function daysBetweenVN(aStr, bStr) {
  const a = aStr && aStr.split('-').map(Number)
  const b = bStr && bStr.split('-').map(Number)
  if (!a || !b || a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return null
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000)
}
function minutesOf(timeStr) {
  const [hours, minutes] = String(timeStr).split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

const dataDir = devTestInstance
  ? path.join(app.getPath('userData'), 'data')
  : app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(app.getAppPath(), 'data')

function seedDataIfMissing() {
  if (!app.isPackaged) return
  const seedDir = path.join(process.resourcesPath, 'app-data-seed')
  if (!fs.existsSync(seedDir)) return
  fs.mkdirSync(dataDir, { recursive: true })
  for (const file of fs.readdirSync(seedDir)) {
    const dest = path.join(dataDir, file)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(seedDir, file), dest)
    }
  }
}
seedDataIfMissing()

const tasks = new JsonCollection(dataDir, 'tasks')
const employees = new JsonCollection(dataDir, 'employees')
const settingsStore = new JsonCollection(dataDir, 'settings')
const tokenStore = new JsonCollection(dataDir, 'tokens')
const alarmStore = new JsonCollection(dataDir, 'alarms')
const notificationStateStore = new JsonCollection(dataDir, 'notification-state')

// Initialize LAN sync engine
const lanSync = new LanSyncManager({ tasks, employees, settings: settingsStore })

async function getSettings() {
  const all = await settingsStore.list()
  return (
    all[0] || {
      deviceName: lanSync.deviceName,
      clientId: '',
      clientSecret: '',
      calendarId: 'primary',
      lan: {
        mode: 'standalone',
        hostPort: DEFAULT_PORT,
        clientHostIp: '',
        clientHostPort: DEFAULT_PORT,
        autoConnect: true
      }
    }
  )
}

async function saveSettings(patch) {
  const current = await getSettings()
  if (current.id) return settingsStore.update(current.id, patch)
  return settingsStore.insert(patch)
}

async function getTokens() {
  const all = await tokenStore.list()
  return all[0] || null
}

async function saveTokens(tokens) {
  const current = await getTokens()
  if (current && current.id) return tokenStore.update(current.id, tokens)
  return tokenStore.insert(tokens)
}

async function clearTokens() {
  const current = await getTokens()
  if (current && current.id) await tokenStore.remove(current.id)
}

async function listEmployees() {
  const records = await employees.list()
  const canonicalByKey = new Map()
  const duplicateIds = new Map()
  const unique = []
  for (const employee of records) {
    const key = `${String(employee.name || '').trim().toLocaleLowerCase()}\u0000${String(employee.role || '').trim().toLocaleLowerCase()}`
    const canonical = canonicalByKey.get(key)
    if (canonical) {
      duplicateIds.set(employee.id, canonical.id)
    } else {
      canonicalByKey.set(key, employee)
      unique.push(employee)
    }
  }
  if (duplicateIds.size) {
    const allTasks = await tasks.list()
    for (const task of allTasks) {
      const ids = task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])
      const nextIds = [...new Set(ids.map((id) => duplicateIds.get(id) || id))]
      if (nextIds.some((id, index) => id !== ids[index]) || nextIds.length !== ids.length) {
        await tasks.update(task.id, { assigneeIds: nextIds, assigneeId: null })
      }
    }
    await employees._write(unique)
  }
  return unique
}

async function getAuthClient() {
  const settings = await getSettings()
  const tokens = await getTokens()
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Vui lòng nhập Google Client ID và Client Secret trong Cài đặt trước.')
  }
  if (!tokens) {
    throw new Error('Google Calendar chưa được kết nối. Hãy kết nối trong Cài đặt.')
  }
  return gcal.clientFromTokens(settings.clientId, settings.clientSecret, tokens)
}

let mainWindow = null
let tray = null
let isQuitting = false
let pendingAlarmFocusTaskId = null
let lastExportedFile = null

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'taskboard-notification.png')
  }
  return path.join(app.getAppPath(), 'build', 'icon.png')
}

function createNotification(options, onClick = () => showMainWindow()) {
  const notification = new Notification({
    ...options,
    icon: getAppIconPath()
  })
  activeNotifications.add(notification)
  notification.on('click', onClick)
  notification.on('close', () => activeNotifications.delete(notification))
  return notification
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#F8FAFC',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win

  win.webContents.on('did-finish-load', () => {
    if (isDev && !win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'right' })
    }
    if (pendingAlarmFocusTaskId) {
      const taskId = pendingAlarmFocusTaskId
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('alarms:focus', taskId)
        if (pendingAlarmFocusTaskId === taskId) pendingAlarmFocusTaskId = null
      }, 500)
    }
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

Menu.setApplicationMenu(null)

// Forward LAN events to renderer
lanSync.on('status-changed', (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:status-changed', status)
  }
})

lanSync.on('data-synced', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:data-sync', data)
  }
})

lanSync.on('chat-message', (message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:chat-message', message)
  }
})

lanSync.on('chat-history', (messages) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:chat-history', messages)
  }
})

lanSync.on('client-connect-failed', async () => {
  try {
    const settings = await getSettings()
    await saveSettings({
      lan: { ...(settings.lan || {}), mode: 'client', autoConnect: false }
    })
  } catch (err) {
    console.warn('Could not persist LAN fallback mode:', err.message)
  }
})

// Desktop notifications (Vietnam time)
const notifiedTimedTaskIds = new Set()
const notifiedReminderIds = new Set()
let dailySummaryDate = null
const ALARM_INTERVAL_MS = 60 * 60 * 1000
const activeNotifications = new Set()
let isCheckingDueTasks = false
let notificationStateRecord = null

async function loadNotificationState() {
  const records = await notificationStateStore.list()
  notificationStateRecord = records[0] || await notificationStateStore.insert({
    id: 'desktop',
    notifiedTimedTaskIds: [],
    notifiedReminderIds: [],
    dailySummaryDate: null
  })
  for (const key of notificationStateRecord.notifiedTimedTaskIds || []) notifiedTimedTaskIds.add(key)
  for (const key of notificationStateRecord.notifiedReminderIds || []) notifiedReminderIds.add(key)
  dailySummaryDate = notificationStateRecord.dailySummaryDate || null
}

async function saveNotificationState() {
  if (!notificationStateRecord) return
  notificationStateRecord = await notificationStateStore.update(notificationStateRecord.id, {
    notifiedTimedTaskIds: [...notifiedTimedTaskIds],
    notifiedReminderIds: [...notifiedReminderIds],
    dailySummaryDate
  })
}

function showMainWindow(taskId = null) {
  if (taskId) pendingAlarmFocusTaskId = taskId
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (!mainWindow.webContents.isLoading() && taskId) {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('alarms:focus', taskId)
      if (pendingAlarmFocusTaskId === taskId) pendingAlarmFocusTaskId = null
    }, 500)
  }
}

function sendAlarmState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    alarmStore.list().then((alarms) => mainWindow.webContents.send('alarms:changed', alarms)).catch((err) => {
      console.warn('Could not send alarm state:', err.message)
    })
  }
}

async function notifyAlarm(task, alarm) {
  const now = Date.now()
  const updated = await alarmStore.update(alarm.id, {
    title: task.title,
    lastNotifiedAt: now,
    snoozedUntil: null,
    notificationCount: (alarm.notificationCount || 0) + 1
  })
  const notification = createNotification({
    title: 'TaskBoard — Báo thức công việc',
    body: `${task.title} chưa được xác nhận. Bấm để mở TaskBoard và xác nhận.`,
    urgency: 'critical',
    timeoutType: 'never'
  }, () => showMainWindow(task.id))
  notification.show()
  sendAlarmState()
  return updated
}

async function checkAlarms() {
  if (!Notification.isSupported()) return
  const now = Date.now()
  const allTasks = await tasks.list()
  const alarms = await alarmStore.list()
  const byTaskId = new Map(alarms.map((alarm) => [alarm.taskId, alarm]))
  const today = vnTodayStr()
  const nowTime = vnNowTimeStr()

  for (const task of allTasks) {
    if (!task.alarmEnabled || task.done || !task.dueDate) continue
    const dueAt = task.dueTime ? `${task.dueDate}T${task.dueTime}` : `${task.dueDate}T00:00`
    const dueDateReached = task.dueDate < today || (task.dueDate === today && (!task.dueTime || task.dueTime <= nowTime))
    if (!dueDateReached) continue

    let alarm = byTaskId.get(task.id)
    if (!alarm) {
      alarm = await alarmStore.insert({
        taskId: task.id,
        title: task.title,
        startedAt: now,
        lastNotifiedAt: null,
        acknowledgedAt: null,
        snoozedUntil: null,
        notificationCount: 0,
        dueAt
      })
      byTaskId.set(task.id, alarm)
    }
    if (alarm.acknowledgedAt && alarm.dueAt !== dueAt) {
      alarm = await alarmStore.update(alarm.id, {
        dueAt,
        title: task.title,
        acknowledgedAt: null,
        lastNotifiedAt: null,
        snoozedUntil: null,
        notificationCount: 0
      })
    }
    if (alarm.acknowledgedAt) continue
    if (alarm.snoozedUntil && now < alarm.snoozedUntil) continue
    const snoozeEnded = !!alarm.snoozedUntil
    const hourPassed = !alarm.lastNotifiedAt || now - alarm.lastNotifiedAt >= ALARM_INTERVAL_MS
    if (snoozeEnded || hourPassed) {
      await notifyAlarm(task, alarm)
      alarm.lastNotifiedAt = now
    }
  }

  for (const alarm of alarms) {
    const task = allTasks.find((item) => item.id === alarm.taskId)
    if (!task || task.done || !task.alarmEnabled) await alarmStore.remove(alarm.id)
  }
  sendAlarmState()
}

async function acknowledgeAlarm(taskId) {
  const alarm = (await alarmStore.list()).find((item) => item.taskId === taskId && !item.acknowledgedAt)
  if (!alarm) return null
  const updated = await alarmStore.update(alarm.id, { acknowledgedAt: Date.now() })
  sendAlarmState()
  return updated
}

async function snoozeAlarm(taskId, minutes) {
  const snoozeMinutes = Number(minutes)
  if (!Number.isFinite(snoozeMinutes) || snoozeMinutes <= 0 || snoozeMinutes > 24 * 60) return null
  const alarm = (await alarmStore.list()).find((item) => item.taskId === taskId && !item.acknowledgedAt)
  if (!alarm) return null
  const updated = await alarmStore.update(alarm.id, {
    snoozedUntil: Date.now() + snoozeMinutes * 60 * 1000
  })
  sendAlarmState()
  return updated
}

async function checkDueTasks() {
  if (isCheckingDueTasks) return
  isCheckingDueTasks = true
  try {
  if (!Notification.isSupported()) return
  const today = vnTodayStr()
  const nowTime = vnNowTimeStr()
  const allTasks = await tasks.list()
  const dueToday = allTasks.filter((t) => !t.done && t.dueDate === today)

  for (const t of allTasks) {
    if (t.done || !t.dueDate || !Array.isArray(t.reminderDays)) continue
    const daysUntilDue = daysBetweenVN(today, t.dueDate)
    if (daysUntilDue === null || !t.reminderDays.includes(daysUntilDue)) continue
    const key = `${t.id}:reminder:${daysUntilDue}:${t.dueDate}`
    if (!notifiedReminderIds.has(key)) {
      notifiedReminderIds.add(key)
      createNotification({
        title: 'TaskBoard — Nhắc việc',
        body: `${t.title} còn ${daysUntilDue} ngày đến hạn.`
      }).show()
      await saveNotificationState()
    }
  }

  if (dailySummaryDate !== today) {
    dailySummaryDate = today
    if (dueToday.length > 0) {
      createNotification({
        title: 'TaskBoard — Công việc hôm nay',
        body: `Bạn có ${dueToday.length} công việc cần hoàn thành hôm nay.`
      }).show()
      await saveNotificationState()
    }
  }

  for (const t of dueToday) {
    if (!t.dueTime) continue
    const key = `${t.id}:${t.dueDate}:${t.dueTime}`
    const currentMinutes = minutesOf(nowTime)
    const dueMinutes = minutesOf(t.dueTime)
    const minutesLate = currentMinutes === null || dueMinutes === null ? -1 : currentMinutes - dueMinutes
    if (minutesLate >= 0 && minutesLate <= 10 && !notifiedTimedTaskIds.has(key)) {
      notifiedTimedTaskIds.add(key)
      createNotification({
        title: 'TaskBoard — Đến giờ làm việc',
        body: t.title
      }).show()
      await saveNotificationState()
    }
  }
  await checkAlarms()
  } finally {
    isCheckingDueTasks = false
  }
}

async function initLanFromSettings() {
  try {
    const settings = await getSettings()
    lanSync.setDeviceName(settings.deviceName || lanSync.deviceName)
    const lan = settings.lan || {}

    if (lan.mode === 'host') {
      await lanSync.startHost(lan.hostPort || DEFAULT_PORT)
    } else if (lan.mode === 'client') {
      if (lan.clientHostIp && lan.autoConnect !== false) {
        await lanSync.startClient(lan.clientHostIp, lan.clientHostPort || DEFAULT_PORT, true)
      } else {
        await lanSync.startClient('', lan.clientHostPort || DEFAULT_PORT, false)
      }
    }
  } catch (err) {
    console.warn('LAN init warning:', err.message)
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  const iconPath = getAppIconPath()
  const trayIcon = nativeImage.createFromPath(iconPath)
  if (trayIcon.isEmpty()) {
    console.warn(`Không tìm thấy icon TaskBoard tại: ${iconPath}`)
  }
  tray = new Tray(trayIcon)
  tray.setToolTip('TaskBoard')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở TaskBoard', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Thoát', click: () => { isQuitting = true; app.quit() } }
  ]))
  tray.on('double-click', () => showMainWindow())

  app.on('second-instance', () => {
    showMainWindow()
  })

  createWindow()
  initLanFromSettings()

  loadNotificationState().then(() => {
    checkDueTasks()
    setInterval(checkDueTasks, 30 * 1000)
  }).catch((err) => {
    console.warn('Không thể tải trạng thái thông báo:', err.message)
    checkDueTasks()
    setInterval(checkDueTasks, 30 * 1000)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

app.on('window-all-closed', () => {
  // The window is hidden on close; this is only a safety net for platform shutdown.
  if (isQuitting) {
    lanSync.stopAll()
    if (process.platform !== 'darwin') app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  lanSync.stopAll()
})

// ---------- IPC: tasks ----------
// ---------- IPC: alarms ----------
ipcMain.handle('alarms:list', () => alarmStore.list())
ipcMain.handle('alarms:acknowledge', (_e, taskId) => acknowledgeAlarm(taskId))
ipcMain.handle('alarms:open', () => showMainWindow())
ipcMain.handle('alarms:snooze', (_e, taskId, minutes) => snoozeAlarm(taskId, minutes))
ipcMain.handle('alarms:consumeFocus', () => {
  const taskId = pendingAlarmFocusTaskId
  pendingAlarmFocusTaskId = null
  return taskId
})

ipcMain.handle('tasks:list', () => tasks.list())

ipcMain.handle('tasks:add', async (_e, task) => {
  if (task.personal) {
    return tasks.insert(task)
  }
  if (lanSync.mode === 'client') {
    if (!lanSync.clientConnected) {
      throw new Error('Cần kết nối máy chủ LAN để thêm công việc chung.')
    }
    const created = await lanSync.sendClientAction('tasks:add', task)
    if (!(await tasks.get(created.id))) await tasks.insert(created)
    return created
  }
  const saved = await tasks.insert(task)
  lanSync.notifyHostLocalChange('tasks:add', saved)
  return saved
})

ipcMain.handle('tasks:update', async (_e, id, patch) => {
  const existing = await tasks.get(id)
  if (existing?.personal) {
    return tasks.update(id, completionPatch(existing, patch))
  }
  if (lanSync.mode === 'client') {
    if (!patch || Object.keys(patch).length !== 1 || patch.done !== true) {
      throw new Error('Máy khách chỉ được đánh dấu hoàn thành công việc chung.')
    }
    if (!lanSync.clientConnected) {
      throw new Error('Cần kết nối máy chủ LAN để cập nhật công việc chung.')
    }
    const updated = await lanSync.sendClientAction('tasks:update', { id, patch })
    if (!updated) throw new Error('Không tìm thấy công việc để cập nhật.')
    await tasks.update(id, {
      done: updated.done,
      completedAt: updated.completedAt ?? null
    })
    return updated
  }
  const updated = await tasks.update(id, completionPatch(existing, patch))
  if (!updated) throw new Error('Không tìm thấy công việc để cập nhật.')
  lanSync.notifyHostLocalChange('tasks:update', updated)
  return updated
})

ipcMain.handle('tasks:delete', async (_e, id) => {
  const task = await tasks.get(id)
  let removed
  if (task?.personal) {
    removed = await tasks.remove(id)
  } else if (lanSync.mode === 'client') {
    throw new Error('Chỉ máy chủ mới có quyền xóa công việc chung.')
  } else {
    removed = await tasks.remove(id)
    lanSync.notifyHostLocalChange('tasks:delete', { id })
  }
  if (removed && task && task.calendarEventId) {
    try {
      const settings = await getSettings()
      const auth = await getAuthClient()
      await gcal.deleteEvent(auth, settings.calendarId || 'primary', task.calendarEventId)
    } catch (err) {
      console.warn('Could not delete Google Calendar event:', err.message)
    }
  }
  return removed
})

// ---------- IPC: employees ----------
ipcMain.handle('employees:list', () => listEmployees())

ipcMain.handle('employees:add', async (_e, employee) => {
  const normalizedName = String(employee?.name || '').trim().toLocaleLowerCase()
  const normalizedRole = String(employee?.role || '').trim().toLocaleLowerCase()
  const existing = (await listEmployees()).find(
    (item) =>
      String(item.name || '').trim().toLocaleLowerCase() === normalizedName &&
      String(item.role || '').trim().toLocaleLowerCase() === normalizedRole
  )
  if (existing) return existing
  if (lanSync.mode === 'client' && lanSync.clientConnected) {
    const created = await lanSync.sendClientAction('employees:add', employee)
    if (!(await employees.get(created.id))) await employees.insert(created)
    return created
  }
  const saved = await employees.insert(employee)
  lanSync.notifyHostLocalChange('employees:add', saved)
  return saved
})

ipcMain.handle('employees:update', async (_e, id, patch) => {
  if (lanSync.mode === 'client' && lanSync.clientConnected) {
    const updated = await lanSync.sendClientAction('employees:update', { id, patch })
    await employees.update(id, patch)
    return updated
  }
  const updated = await employees.update(id, patch)
  lanSync.notifyHostLocalChange('employees:update', updated)
  return updated
})

ipcMain.handle('employees:delete', async (_e, id) => {
  if (lanSync.mode === 'client' && lanSync.clientConnected) {
    const res = await lanSync.sendClientAction('employees:delete', { id })
    await employees.remove(id)
    return res
  }
  const allTasks = await tasks.list()
  const affected = allTasks.filter((t) => (t.assigneeIds || (t.assigneeId ? [t.assigneeId] : [])).includes(id))
  await Promise.all(
    affected.map((t) => {
      const current = t.assigneeIds || (t.assigneeId ? [t.assigneeId] : [])
      return tasks.update(t.id, { assigneeIds: current.filter((aid) => aid !== id), assigneeId: null })
    })
  )
  const removed = await employees.remove(id)
  lanSync.notifyHostLocalChange('employees:delete', { id })
  return removed
})

// ---------- IPC: settings ----------
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:save', async (_e, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'deviceName')) {
    const deviceName = String(patch.deviceName || '').trim()
    if (!deviceName) throw new Error('Tên hiển thị không được để trống.')
    if (deviceName.length > 40) throw new Error('Tên hiển thị không được vượt quá 40 ký tự.')
    const saved = await saveSettings({ ...patch, deviceName })
    lanSync.setDeviceName(deviceName)
    return saved
  }
  return saveSettings(patch)
})

// ---------- IPC: LAN Sync ----------
ipcMain.handle('lan:getStatus', () => lanSync.getStatus())
ipcMain.handle('lan:getLocalIps', () => getLocalIpAddresses())
ipcMain.handle('lan:discoverHosts', () => lanSync.discoverHosts())
ipcMain.handle('lan:getChatHistory', () => lanSync.getChatHistory())
ipcMain.handle('lan:getDirectChatHistory', (_e, participantId) => lanSync.getDirectChatHistory(participantId))
ipcMain.handle('lan:sendChat', (_e, text, recipientId) => {
  if (lanSync.mode === 'host') return lanSync.sendHostChat(text, recipientId)
  if (lanSync.mode === 'client') return lanSync.sendClientChat(text, recipientId)
  throw new Error('Kết nối máy chủ LAN trước khi gửi tin nhắn.')
})

ipcMain.handle('lan:startHost', async (_e, port) => {
  const portNum = Number(port) || DEFAULT_PORT
  const settings = await getSettings()
  await saveSettings({
    lan: { ...(settings.lan || {}), mode: 'host', hostPort: portNum }
  })
  return await lanSync.startHost(portNum)
})

ipcMain.handle('lan:stopHost', async () => {
  const settings = await getSettings()
  await saveSettings({
    lan: { ...(settings.lan || {}), mode: 'standalone' }
  })
  lanSync.stopHost()
  return lanSync.getStatus()
})

ipcMain.handle('lan:startClient', async (_e, hostIp, port, autoConnect = true) => {
  const portNum = Number(port) || DEFAULT_PORT
  const settings = await getSettings()
  await saveSettings({
    lan: {
      ...(settings.lan || {}),
      mode: 'client',
      clientHostIp: hostIp,
      clientHostPort: portNum,
      autoConnect
    }
  })

  await lanSync.startClient(hostIp, portNum, autoConnect)
  return lanSync.getStatus()
})

ipcMain.handle('lan:stopClient', async () => {
  const settings = await getSettings()
  await saveSettings({
    lan: { ...(settings.lan || {}), mode: 'client', autoConnect: false }
  })
  lanSync.stopClient()
  return lanSync.getStatus()
})

ipcMain.handle('lan:setStandalone', async () => {
  const settings = await getSettings()
  await saveSettings({
    lan: { ...(settings.lan || {}), mode: 'standalone' }
  })
  await lanSync.stopAll()
  return lanSync.getStatus()
})

// ---------- IPC: DOCX Export ----------
ipcMain.handle('export:tasksDocx', async (_e, options = {}) => {
  const allTasks = await tasks.list()
  const allEmployees = await employees.list()
  const buffer = await generateTasksDocx(allTasks, allEmployees, options)

  const defaultFileName = `TaskBoard_Bang_cong_viec_${vnTodayStr()}.docx`
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Lưu bảng công việc Word (.docx)',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'Word Document (*.docx)', extensions: ['docx'] }]
  })

  if (canceled || !filePath) {
    return { canceled: true }
  }

  await fs.promises.writeFile(filePath, buffer)
  lastExportedFile = filePath
  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath)
  }
})

ipcMain.handle('shell:openPath', async (_e, filePath) => {
  if (filePath && typeof filePath === 'string' && filePath === lastExportedFile) {
    return shell.openPath(filePath)
  }
  return 'Từ chối mở đường dẫn không phải file vừa xuất.'
})

// ---------- IPC: Google Calendar ----------
ipcMain.handle('calendar:status', async () => {
  const settings = await getSettings()
  const tokens = await getTokens()
  return {
    configured: !!(settings.clientId && settings.clientSecret),
    connected: !!tokens,
    calendarId: settings.calendarId || 'primary'
  }
})

ipcMain.handle('calendar:connect', async () => {
  const settings = await getSettings()
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Vui lòng nhập Google Client ID và Client Secret trước.')
  }
  const tokens = await gcal.runOAuthFlow(settings.clientId, settings.clientSecret, (url) =>
    shell.openExternal(url)
  )
  await saveTokens(tokens)
  return { connected: true }
})

ipcMain.handle('calendar:disconnect', async () => {
  await clearTokens()
  return { connected: false }
})

ipcMain.handle('calendar:listCalendars', async () => {
  const auth = await getAuthClient()
  return gcal.listCalendars(auth)
})

ipcMain.handle('calendar:sync', async (_e, taskId) => {
  const settings = await getSettings()
  const task = await tasks.get(taskId)
  if (!task) throw new Error('Không tìm thấy công việc')
  if (!task.dueDate) throw new Error('Hãy thêm ngày hết hạn trước khi đồng bộ với Google Calendar.')

  const auth = await getAuthClient()
  const event = await gcal.upsertEvent(auth, settings.calendarId || 'primary', task, task.calendarEventId)
  await tasks.update(taskId, { calendarEventId: event.id })
  return { eventId: event.id, htmlLink: event.htmlLink }
})
