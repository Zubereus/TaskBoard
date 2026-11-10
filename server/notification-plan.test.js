import { describe, expect, it } from 'vitest'
import planModule from './notification-plan.js'

const {
  planDueNotifications,
  planNotificationDelivery,
  summarizeTaskStatus,
  listOverdueTasks,
  pruneAcknowledgedKeys,
  planReturnSummary,
  buildAgenda,
  planCornerWidget
} = planModule

const TODAY = '2026-11-09'
const plan = (tasks, nowTime, state) => planDueNotifications({ tasks, today: TODAY, nowTime, state })
const task = (extra) => ({ id: 't1', title: 'Nộp báo cáo', done: false, ...extra })

describe('due-time and overdue notifications', () => {
  it('sends the "it\'s time" toast when the check lands inside the 10-minute window', () => {
    const { notifications } = plan([task({ dueDate: TODAY, dueTime: '14:00' })], '14:05')
    expect(notifications.map((n) => n.title)).toContain('TaskBoard — Đến giờ làm việc')
  })

  it('reports a missed timed task once instead of dropping it', () => {
    const tasks = [task({ dueDate: TODAY, dueTime: '14:00' })]
    const first = plan(tasks, '17:30')
    expect(first.notifications.map((n) => n.title)).toContain('TaskBoard — Công việc quá hạn')
    const second = plan(tasks, '17:31', first.nextState)
    expect(second.notifications.map((n) => n.title)).not.toContain('TaskBoard — Công việc quá hạn')
  })

  it('does not repeat the "it\'s time" toast as an overdue toast later', () => {
    const tasks = [task({ dueDate: TODAY, dueTime: '14:00' })]
    const first = plan(tasks, '14:02')
    const later = plan(tasks, '16:00', first.nextState)
    expect(later.notifications).toEqual([])
  })

  it('queues notifications while away and delivers them on return', () => {
    const tasks = [
      task({ id: 'reminder', dueDate: '2026-11-10', reminderDays: [1] }),
      task({ id: 'overdue', dueDate: '2026-11-08' })
    ]
    const whileAway = plan(tasks, '14:05')
    const deferred = planNotificationDelivery({
      pending: [],
      notifications: whileAway.notifications,
      defer: true
    })
    expect(deferred.notifications).toEqual([])
    expect(deferred.pending.map(({ title }) => title)).toEqual([
      'TaskBoard — Nhắc việc',
      'TaskBoard — Công việc quá hạn'
    ])

    const nextDay = planDueNotifications({
      tasks,
      today: '2026-11-10',
      nowTime: '09:05',
      state: whileAway.nextState
    })
    const onReturn = planNotificationDelivery({
      pending: deferred.pending,
      notifications: nextDay.notifications,
      defer: false
    })
    expect(onReturn.notifications.map(({ title }) => title)).toContain('TaskBoard — Nhắc việc')
    expect(onReturn.notifications.map(({ title }) => title)).toContain('TaskBoard — Công việc quá hạn')
    expect(onReturn.pending).toEqual([])
  })

  it('turns a date-only task overdue on the next day, not on its own day', () => {
    const tasks = [task({ dueDate: '2026-11-08' })]
    expect(plan(tasks, '09:00').notifications.map((n) => n.title)).toContain('TaskBoard — Công việc quá hạn')
    expect(plan([task({ dueDate: TODAY })], '23:59').notifications.map((n) => n.title))
      .not.toContain('TaskBoard — Công việc quá hạn')
  })

  it('combines several overdue tasks into one toast', () => {
    const tasks = ['a', 'b', 'c', 'd'].map((id) => task({ id, title: `Việc ${id}`, dueDate: '2026-11-01' }))
    const overdue = plan(tasks, '09:00').notifications.filter((n) => n.title.includes('quá hạn'))
    expect(overdue).toHaveLength(1)
    expect(overdue[0].body).toContain('4 công việc quá hạn')
    expect(overdue[0].body).toContain('và 1 việc khác')
  })

  it('leaves overdue tasks with the hourly alarm to the alarm, and skips done tasks', () => {
    const tasks = [
      task({ id: 'alarm', dueDate: '2026-11-01', alarmEnabled: true }),
      task({ id: 'finished', dueDate: '2026-11-01', done: true })
    ]
    expect(plan(tasks, '09:00').notifications).toEqual([])
  })
})

describe('daily summary', () => {
  it('announces tasks due today once', () => {
    const tasks = [task({ dueDate: TODAY })]
    const first = plan(tasks, '08:00')
    expect(first.notifications[0].body).toBe('Bạn có 1 công việc cần hoàn thành hôm nay.')
    expect(plan(tasks, '08:01', first.nextState).notifications).toEqual([])
  })

  it('announces a task that becomes due-today after the first check', () => {
    const first = plan([], '08:00')
    const second = plan([task({ id: 'late-sync', title: 'Việc mới', dueDate: TODAY })], '10:00', first.nextState)
    expect(second.notifications).toEqual([
      { title: 'TaskBoard — Công việc hôm nay', body: 'Bạn có 1 công việc cần hoàn thành hôm nay.' }
    ])
  })

  it('mentions only the new task on a later announcement', () => {
    const first = plan([task({ id: 'a', title: 'Việc A', dueDate: TODAY })], '08:00')
    const second = plan(
      [task({ id: 'a', title: 'Việc A', dueDate: TODAY }), task({ id: 'b', title: 'Việc B', dueDate: TODAY })],
      '10:00',
      first.nextState
    )
    expect(second.notifications[0].body).toBe('Có 1 công việc mới đến hạn hôm nay: Việc B.')
  })

  it('does not re-announce after upgrading from state saved by the old version', () => {
    const legacyState = { dailySummaryDate: TODAY, notifiedTimedTaskIds: [], notifiedReminderIds: [] }
    expect(plan([task({ dueDate: TODAY })], '09:00', legacyState).notifications).toEqual([])
  })

  it('resets the covered list on a new day', () => {
    const first = plan([task({ dueDate: TODAY })], '08:00')
    const nextDay = planDueNotifications({
      tasks: [task({ dueDate: '2026-11-10' })],
      today: '2026-11-10',
      nowTime: '08:00',
      state: first.nextState
    })
    expect(nextDay.notifications[0].body).toBe('Bạn có 1 công việc cần hoàn thành hôm nay.')
  })
})

describe('reminders and state', () => {
  it('sends each day-before reminder once', () => {
    const tasks = [task({ dueDate: '2026-11-11', reminderDays: [2, 7] })]
    const first = plan(tasks, '08:00')
    expect(first.notifications).toEqual([{ title: 'TaskBoard — Nhắc việc', body: 'Nộp báo cáo còn 2 ngày đến hạn.' }])
    expect(plan(tasks, '08:01', first.nextState).notifications).toEqual([])
  })

  it('reports no change when nothing happened, so main.js can skip the disk write', () => {
    const first = plan([], '08:00')
    expect(plan([], '08:01', first.nextState).changed).toBe(false)
  })
})

describe('tray status', () => {
  it('counts overdue and still-upcoming tasks separately', () => {
    const tasks = [
      task({ id: 'a', dueDate: '2026-11-01' }),
      task({ id: 'b', dueDate: TODAY, dueTime: '09:00' }),
      task({ id: 'c', dueDate: TODAY, dueTime: '18:00' }),
      task({ id: 'd', dueDate: TODAY }),
      task({ id: 'e', dueDate: TODAY, done: true })
    ]
    expect(summarizeTaskStatus({ tasks, today: TODAY, nowTime: '10:00' })).toEqual({ overdue: 2, dueToday: 2 })
  })
})

describe('overdue panel list', () => {
  // 2026-11-09 10:00 in the test's own timeline; only minute-level offsets matter
  const NOW = Date.UTC(2026, 10, 9, 3, 0, 0, 25000)
  const list = (tasks, acknowledgedKeys = [], nowTime = '10:00') =>
    listOverdueTasks({ tasks, today: TODAY, nowTime, nowMs: NOW, acknowledgedKeys })

  it('lists overdue, unfinished tasks, most overdue first', () => {
    const entries = list([
      task({ id: 'recent', dueDate: TODAY, dueTime: '09:30' }),
      task({ id: 'old', dueDate: '2026-11-01' }),
      task({ id: 'future', dueDate: TODAY, dueTime: '18:00' }),
      task({ id: 'today-no-time', dueDate: TODAY }),
      task({ id: 'finished', dueDate: '2026-11-01', done: true })
    ])
    expect(entries.map((entry) => entry.taskId)).toEqual(['old', 'recent'])
  })

  it('leaves alarm tasks to the alarm panel', () => {
    expect(list([task({ dueDate: '2026-11-01', alarmEnabled: true })])).toEqual([])
  })

  it('hides acknowledged tasks, and brings one back when its deadline changes', () => {
    const original = task({ dueDate: '2026-11-01' })
    const [entry] = list([original])
    expect(list([original], [entry.key])).toEqual([])
    expect(list([{ ...original, dueDate: '2026-11-05' }], [entry.key])).toHaveLength(1)
  })

  it('computes when the task became overdue, to the minute', () => {
    const [entry] = list([task({ dueDate: TODAY, dueTime: '09:30' })])
    expect(entry.overdueSince).toBe(Date.UTC(2026, 10, 9, 2, 30, 0, 0))
  })

  it('treats a date-only task as overdue from midnight on the next day', () => {
    // 00:00 on 2026-11-09 in Vietnam (UTC+7) is 17:00 UTC on the 8th
    const midnightVn = Date.UTC(2026, 10, 8, 17, 0, 12)
    const [entry] = listOverdueTasks({
      tasks: [task({ dueDate: '2026-11-08' })],
      today: TODAY,
      nowTime: '00:00',
      nowMs: midnightVn
    })
    expect(entry.overdueSince).toBe(Date.UTC(2026, 10, 8, 17, 0, 0))
  })
})

describe('acknowledgement housekeeping', () => {
  it('drops acknowledgements for deadlines older than 90 days', () => {
    const keys = ['a:2026-11-01:', 'b:2026-06-01:', 'c:garbage']
    expect(pruneAcknowledgedKeys(keys, TODAY)).toEqual(['a:2026-11-01:'])
  })
})

describe('return summary', () => {
  const entry = (title, overdueSince) => ({ taskId: title, title, key: title, overdueSince })

  it('mentions only tasks that became overdue after the person left', () => {
    const summary = planReturnSummary({
      overdue: [entry('Cũ', 1000), entry('Mới', 5000)],
      awaySince: 3000
    })
    expect(summary).toEqual({ title: 'TaskBoard — Trong lúc bạn vắng mặt', body: 'Mới đã quá hạn.' })
  })

  it('combines several into one message and stays silent when nothing is new', () => {
    const summary = planReturnSummary({
      overdue: ['A', 'B', 'C', 'D', 'E'].map((title) => entry(title, 5000)),
      awaySince: 3000
    })
    expect(summary.body).toBe('5 công việc đã quá hạn: A, B, C và 2 việc khác.')
    expect(planReturnSummary({ overdue: [entry('Cũ', 1000)], awaySince: 3000 })).toBeNull()
  })
})

describe('flyout agenda', () => {
  const NOW = Date.UTC(2026, 10, 9, 3, 0, 0)
  it('lists overdue tasks plus what is still due later today, in time order', () => {
    const agenda = buildAgenda({
      tasks: [
        task({ id: 'late', dueDate: '2026-11-08' }),
        task({ id: 'evening', title: 'Tối', dueDate: TODAY, dueTime: '18:00' }),
        task({ id: 'noon', title: 'Trưa', dueDate: TODAY, dueTime: '12:00' }),
        task({ id: 'any', title: 'Cả ngày', dueDate: TODAY }),
        task({ id: 'passed', dueDate: TODAY, dueTime: '09:00' }),
        task({ id: 'tomorrow', dueDate: '2026-11-10' })
      ],
      today: TODAY,
      nowTime: '10:00',
      nowMs: NOW
    })
    expect(agenda.overdue.map((entry) => entry.taskId)).toEqual(['late', 'passed'])
    expect(agenda.dueToday.map((entry) => entry.taskId)).toEqual(['noon', 'evening', 'any'])
  })
})

describe('corner widget rules', () => {
  const entry = (key) => ({ taskId: key, title: key, key, overdueSince: 0 })
  const plan = (extra) => planCornerWidget({
    overdue: [entry('a'), entry('b')],
    dismissedKeys: [],
    enabled: true,
    mainWindowFocused: false,
    ...extra
  })

  it('shows unseen overdue tasks', () => {
    expect(plan({}).visible).toBe(true)
    expect(plan({}).entries.map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('stays hidden once dismissed, and returns for a new task', () => {
    expect(plan({ dismissedKeys: ['a', 'b'] }).visible).toBe(false)
    const withNew = planCornerWidget({
      overdue: [entry('a'), entry('b'), entry('c')],
      dismissedKeys: ['a', 'b'],
      enabled: true,
      mainWindowFocused: false
    })
    expect(withNew.entries.map((e) => e.key)).toEqual(['c'])
  })

  it('stays hidden when switched off or when the app window is in front without marking tasks dismissed', () => {
    expect(plan({ enabled: false }).visible).toBe(false)
    expect(plan({ mainWindowFocused: true }).visible).toBe(false)
    expect(plan({ mainWindowFocused: true }).unseen).toHaveLength(2)
    expect(plan({ mainWindowFocused: false }).entries.map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('is silent with nothing overdue', () => {
    expect(plan({ overdue: [] }).visible).toBe(false)
  })
})
