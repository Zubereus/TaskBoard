import { describe, expect, it } from 'vitest'
import { countTasksForExport, filterOverdueTasks, filterTasksForExport } from './export-filter.mjs'

describe('overdue Word export filter', () => {
  const today = '2026-11-10'
  const nowTime = '13:00'
  const tasks = [
    { id: 'past-day', dueDate: '2026-11-09', done: false },
    { id: 'past-time', dueDate: today, dueTime: '12:59', done: false },
    { id: 'same-minute', dueDate: today, dueTime: nowTime, done: false },
    { id: 'later', dueDate: today, dueTime: '13:01', done: false },
    { id: 'date-only-today', dueDate: today, done: false },
    { id: 'no-date', done: false },
    { id: 'completed-overdue', dueDate: '2026-11-09', done: true }
  ]

  it('uses the task deadline and excludes completed, future, and date-only-today tasks', () => {
    expect(filterOverdueTasks(tasks, today, nowTime).map((task) => task.id)).toEqual([
      'past-day',
      'past-time',
      'same-minute'
    ])
  })

  it('applies scope before counting overdue tasks and never includes completed work', () => {
    const scoped = filterTasksForExport(
      tasks.map((task) => ({ ...task, personal: task.id === 'past-day' })),
      'shared',
      true
    )
    expect(countTasksForExport(scoped, 'all', true, {
      onlyOverdue: true,
      today,
      nowTime
    })).toBe(2)
  })
})
