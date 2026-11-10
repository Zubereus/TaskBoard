// Decides which desktop notifications are due, without touching Electron, the
// clock or the disk. main.js passes in the tasks that target this install, the
// current Vietnam date/time and the persisted state, then shows what comes
// back and stores `nextState`.

const MINUTES_PER_DAY = 24 * 60
// A timed task gets the "it's time" toast when the check lands this soon after
// the due time. Anything later is reported once as overdue instead.
const JUST_DUE_WINDOW_MINUTES = 10

function minutesOf(timeStr) {
  if (!timeStr) return null
  const [hours, minutes] = String(timeStr).split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

function daysBetween(aStr, bStr) {
  const a = aStr && aStr.split('-').map(Number)
  const b = bStr && bStr.split('-').map(Number)
  if (!a || !b || a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return null
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000)
}

// Minutes since the task became due (negative while it is still in the future).
// A task without a time is due when its date ends, so it turns overdue at
// midnight rather than at the start of its own day.
function minutesLate(task, today, nowMinutes) {
  const dayGap = daysBetween(task.dueDate, today)
  if (dayGap === null || nowMinutes === null) return null
  const dueMinutes = minutesOf(task.dueTime)
  return dayGap * MINUTES_PER_DAY + nowMinutes - (dueMinutes === null ? MINUTES_PER_DAY : dueMinutes)
}

function taskKey(task) {
  return `${task.id}:${task.dueDate}:${task.dueTime || ''}`
}

function listTitles(items, limit = 3) {
  const shown = items.slice(0, limit).map((task) => task.title).join(', ')
  const rest = items.length - limit
  return rest > 0 ? `${shown} và ${rest} việc khác` : shown
}

function normalizeState(state) {
  return {
    timedKeys: state?.notifiedTimedTaskIds || [],
    reminderKeys: state?.notifiedReminderIds || [],
    summaryDate: state?.dailySummaryDate || null,
    // null = state written before per-task summaries existed
    summaryTaskIds: Array.isArray(state?.dailySummaryTaskIds) ? state.dailySummaryTaskIds : null
  }
}

function planDueNotifications({ tasks, today, nowTime, state }) {
  const prior = normalizeState(state)
  const nowMinutes = minutesOf(nowTime)
  const open = tasks.filter((task) => !task.done)

  // "N days before the deadline" reminders: one per task and milestone.
  const reminders = open
    .filter((task) => task.dueDate && Array.isArray(task.reminderDays))
    .map((task) => ({ task, days: daysBetween(today, task.dueDate) }))
    .filter(({ task, days }) => days !== null && task.reminderDays.includes(days))
    .map(({ task, days }) => ({ task, days, key: `${task.id}:reminder:${days}:${task.dueDate}` }))
    .filter(({ key }) => !prior.reminderKeys.includes(key))

  // Daily summary. Remembers which tasks it already mentioned today, so a task
  // that becomes due-today later (created or synced after the first check)
  // still gets announced.
  const dueToday = open.filter((task) => task.dueDate === today)
  const covered = prior.summaryDate !== today
    ? []
    : prior.summaryTaskIds === null
      ? dueToday.map((task) => task.id)
      : prior.summaryTaskIds
  const fresh = dueToday.filter((task) => !covered.includes(task.id))
  const summary = fresh.length === 0
    ? []
    : [{
        title: 'TaskBoard — Công việc hôm nay',
        body: covered.length === 0
          ? `Bạn có ${dueToday.length} công việc cần hoàn thành hôm nay.`
          : `Có ${fresh.length} công việc mới đến hạn hôm nay: ${listTitles(fresh)}.`
      }]

  // Due-time and overdue handling. There is no upper bound on lateness: a
  // notification that was missed (nobody at the desk, app busy, task synced
  // late) is still delivered once on the next check.
  const reached = open
    .filter((task) => task.dueDate)
    .map((task) => ({ task, key: taskKey(task), late: minutesLate(task, today, nowMinutes) }))
    .filter(({ key, late }) => late !== null && late >= 0 && !prior.timedKeys.includes(key))
  const isJustDue = ({ task, late }) => Boolean(task.dueTime) && late <= JUST_DUE_WINDOW_MINUTES
  const justDue = reached.filter(isJustDue)
  // Tasks with the hourly alarm already repeat until acknowledged.
  const overdue = reached.filter((entry) => !isJustDue(entry) && !entry.task.alarmEnabled)

  const overdueNotes = overdue.length === 0
    ? []
    : [{
        title: 'TaskBoard — Công việc quá hạn',
        body: overdue.length === 1
          ? `${overdue[0].task.title} đã quá hạn.`
          : `Bạn có ${overdue.length} công việc quá hạn: ${listTitles(overdue.map(({ task }) => task))}.`
      }]

  const notifications = [
    ...reminders.map(({ task, days }) => ({
      title: 'TaskBoard — Nhắc việc',
      body: `${task.title} còn ${days} ngày đến hạn.`
    })),
    ...summary,
    ...justDue.map(({ task }) => ({ title: 'TaskBoard — Đến giờ làm việc', body: task.title })),
    ...overdueNotes
  ]

  const nextState = {
    notifiedTimedTaskIds: [...new Set([
      ...prior.timedKeys,
      ...justDue.map(({ key }) => key),
      ...overdue.map(({ key }) => key)
    ])],
    notifiedReminderIds: [...prior.reminderKeys, ...reminders.map(({ key }) => key)],
    dailySummaryDate: today,
    dailySummaryTaskIds: [...new Set([...covered, ...dueToday.map((task) => task.id)])]
  }
  const priorSnapshot = {
    notifiedTimedTaskIds: prior.timedKeys,
    notifiedReminderIds: prior.reminderKeys,
    dailySummaryDate: prior.summaryDate,
    dailySummaryTaskIds: prior.summaryTaskIds
  }

  return {
    notifications,
    nextState,
    changed: JSON.stringify(nextState) !== JSON.stringify(priorSnapshot)
  }
}

function planNotificationDelivery({ pending = [], notifications = [], defer }) {
  const queued = [...pending, ...notifications]
  return defer
    ? { notifications: [], pending: queued }
    : { notifications: queued, pending: [] }
}

// Counts for the tray tooltip. A task due today at 09:00 counts as overdue
// after 09:00, not as "due today".
function summarizeTaskStatus({ tasks, today, nowTime }) {
  const nowMinutes = minutesOf(nowTime)
  const open = tasks.filter((task) => !task.done && task.dueDate)
  const overdue = open.filter((task) => {
    const late = minutesLate(task, today, nowMinutes)
    return late !== null && late >= 0
  })
  const dueToday = open.filter((task) => task.dueDate === today && !overdue.includes(task))
  return { overdue: overdue.length, dueToday: dueToday.length }
}

// Tasks shown in the persistent overdue panel: assigned to this person,
// overdue, not done, not already covered by the hourly alarm (which has its own
// panel), and not acknowledged. `overdueSince` is when the task became overdue,
// to the minute, in epoch milliseconds.
function listOverdueTasks({ tasks, today, nowTime, nowMs, acknowledgedKeys = [] }) {
  const nowMinutes = minutesOf(nowTime)
  const minuteStart = Math.floor(nowMs / 60000) * 60000
  return tasks
    .filter((task) => !task.done && task.dueDate && !task.alarmEnabled)
    .map((task) => ({ task, key: taskKey(task), late: minutesLate(task, today, nowMinutes) }))
    .filter(({ key, late }) => late !== null && late >= 0 && !acknowledgedKeys.includes(key))
    .sort((a, b) => b.late - a.late)
    .map(({ task, key, late }) => ({
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      dueTime: task.dueTime || '',
      key,
      overdueSince: minuteStart - late * 60000
    }))
}

// Acknowledgements only matter while a task can still be overdue, so drop the
// ones for deadlines older than `maxAgeDays` instead of growing forever.
function pruneAcknowledgedKeys(keys, today, maxAgeDays = 90) {
  return keys.filter((key) => {
    const age = daysBetween(String(key).split(':')[1], today)
    return age !== null && age <= maxAgeDays
  })
}

// One toast for what became overdue while the person was away.
function planReturnSummary({ overdue, awaySince }) {
  const missed = overdue.filter((entry) => entry.overdueSince >= awaySince)
  if (missed.length === 0) return null
  return {
    title: 'TaskBoard — Trong lúc bạn vắng mặt',
    body: missed.length === 1
      ? `${missed[0].title} đã quá hạn.`
      : `${missed.length} công việc đã quá hạn: ${listTitles(missed)}.`
  }
}

// What the tray flyout shows besides alarms: the panel's overdue list and the
// tasks still due later today, in time order (tasks without a time last).
function buildAgenda({ tasks, today, nowTime, nowMs, acknowledgedKeys = [] }) {
  const nowMinutes = minutesOf(nowTime)
  const overdue = listOverdueTasks({ tasks, today, nowTime, nowMs, acknowledgedKeys })
  const dueToday = tasks
    .filter((task) => !task.done && task.dueDate === today)
    .filter((task) => {
      const late = minutesLate(task, today, nowMinutes)
      return late !== null && late < 0
    })
    .sort((a, b) =>
      (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') ||
      String(a.title || '').localeCompare(String(b.title || ''))
    )
    .map((task) => ({ taskId: task.id, title: task.title, dueTime: task.dueTime || '' }))
  return { overdue, dueToday }
}

// The corner widget shows overdue tasks unless they explicitly dismissed them.
// It stays hidden while the main app is focused and is off when disabled.
function planCornerWidget({ overdue, dismissedKeys, enabled, mainWindowFocused }) {
  const unseen = overdue.filter((entry) => !dismissedKeys.includes(entry.key))
  const entries = enabled && !mainWindowFocused ? unseen : []
  return { visible: entries.length > 0, entries, unseen }
}

module.exports = {
  planDueNotifications,
  planNotificationDelivery,
  buildAgenda,
  planCornerWidget,
  summarizeTaskStatus,
  listOverdueTasks,
  pruneAcknowledgedKeys,
  planReturnSummary,
  JUST_DUE_WINDOW_MINUTES
}
