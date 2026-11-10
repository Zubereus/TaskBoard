import { describe, expect, it } from 'vitest'
import { calculateStats } from './stats'

describe('task statistics', () => {
  it('counts completed and assigned tasks for legacy and multi-assignee records', () => {
    const employees = [
      { id: 'a', name: 'An' },
      { id: 'b', name: 'Bình' },
      { id: 'c', name: 'Chi' }
    ]
    const tasks = [
      { id: '1', assigneeId: 'a', done: true },
      { id: '2', assigneeIds: ['a', 'b'], done: true },
      { id: '3', assigneeIds: ['b'], done: false },
      { id: '4', assigneeIds: [], done: true }
    ]
    const result = calculateStats(tasks, employees, '2026-10-24')

    expect(result.rows).toEqual([
      { id: 'a', name: 'An', completed: 2, assigned: 2, completionRate: 1, openAssigned: 0, overdue: 0 },
      { id: 'b', name: 'Bình', completed: 1, assigned: 2, completionRate: 0.5, openAssigned: 1, overdue: 0 },
      { id: 'c', name: 'Chi', completed: 0, assigned: 0, completionRate: null, openAssigned: 0, overdue: 0 }
    ])
    expect(result.totalCompleted).toBe(3)
    expect(result.uniqueCompletedTasks).toBe(3)
    expect(result.completedThisWeek).toBe(0)
    expect(result.openTasks).toHaveLength(1)
  })

  it('counts this week completions by Vietnam date and excludes legacy and future dates', () => {
    const tasks = [
      {
        id: 'monday',
        done: true,
        completedAt: '2026-10-25T17:00:00.000Z',
        assigneeIds: ['a', 'b']
      },
      { id: 'friday', done: true, completedAt: '2026-10-30T16:30:00.000Z' },
      { id: 'prior-week', done: true, completedAt: '2026-10-25T16:59:59.999Z' },
      { id: 'tomorrow-vn', done: true, completedAt: '2026-10-30T17:00:00.000Z' },
      { id: 'legacy', done: true },
      { id: 'invalid', done: true, completedAt: 'not-a-timestamp' },
      { id: 'reopened', done: false, completedAt: '2026-10-30T10:00:00.000Z' }
    ]

    expect(calculateStats(tasks, [], '2026-10-30').completedThisWeek).toBe(2)
  })

  it('sorts members by name rather than completion count', () => {
    const result = calculateStats(
      [
        { id: 'z-task', done: true, assigneeIds: ['z'] },
        { id: 'a-task', done: false, assigneeIds: ['a'] }
      ],
      [
        { id: 'z', name: 'Zed' },
        { id: 'a', name: 'An' }
      ],
      '2026-10-30'
    )

    expect(result.rows.map((row) => row.name)).toEqual(['An', 'Zed'])
    expect(result.rows.map((row) => row.completionRate)).toEqual([0, 1])
  })

  it('counts unique upcoming and open tasks once, including due today through seven days out', () => {
    const tasks = [
      { id: 'overdue', done: false, dueDate: '2026-10-23', assigneeIds: ['a'] },
      { id: 'today', done: false, dueDate: '2026-10-24', assigneeIds: ['a', 'b'] },
      { id: 'last-day', done: false, dueDate: '2026-10-31' },
      { id: 'outside-range', done: false, dueDate: '2026-11-01' },
      { id: 'completed', done: true, dueDate: '2026-10-25' },
      { id: 'no-date', done: false }
    ]
    const result = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-10-24')

    expect(result.openTasks.map((task) => task.id)).toEqual([
      'overdue',
      'today',
      'last-day',
      'outside-range',
      'no-date'
    ])
    expect(result.dueSoonTasks.map((task) => task.id)).toEqual(['today', 'last-day'])
    expect(result.rows[0].openAssigned).toBe(2)
  })

  it('counts unassigned work and overdue work separately from member assignments', () => {
    const tasks = [
      { id: 'unassigned-overdue', done: false, dueDate: '2026-10-23', assigneeIds: [] },
      { id: 'unassigned-open', done: false, assigneeIds: [] },
      { id: 'assigned-overdue', done: false, dueDate: '2026-10-23', assigneeIds: ['a'] },
      { id: 'assigned-open', done: false, assigneeIds: ['a'] },
      { id: 'completed-unassigned', done: true, assigneeIds: [] }
    ]
    const result = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-10-24')

    expect(result.unassignedOpenTasks).toBe(2)
    expect(result.unassignedOverdueTasks).toBe(1)
    expect(result.rows[0]).toMatchObject({
      openAssigned: 2,
      overdue: 1,
      completionRate: 0
    })
  })

  it('excludes personal tasks from shared workload and unassigned counts', () => {
    const tasks = [
      { id: 'personal-open', personal: true, done: false },
      { id: 'personal-overdue', personal: true, done: false, dueDate: '2026-10-23' },
      { id: 'personal-assigned', personal: true, done: false, assigneeIds: ['a'] },
      { id: 'shared-unassigned', done: false },
      { id: 'shared-overdue', done: false, dueDate: '2026-10-23' },
      { id: 'shared-assigned', done: false, assigneeIds: ['a'] }
    ]
    const result = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-10-24')

    expect(result.openTasks).toHaveLength(6)
    expect(result.overdueTasks.map((task) => task.id)).toEqual([
      'personal-overdue',
      'shared-overdue'
    ])
    expect(result.unassignedOpenTasks).toBe(2)
    expect(result.unassignedOverdueTasks).toBe(1)
    expect(result.rows[0]).toMatchObject({
      assigned: 1,
      openAssigned: 1,
      overdue: 0
    })
  })

  it('counts shared tasks assigned to missing employees as unassigned', () => {
    const tasks = [
      { id: 'without-assignee', done: false },
      { id: 'deleted-member', assigneeIds: ['removed-member'], done: false },
      { id: 'legacy-deleted-member', assigneeId: 'removed-member', done: false, dueDate: '2026-10-23' },
      { id: 'current-member', assigneeIds: ['a'], done: false }
    ]
    const result = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-10-24')

    expect(result.unassignedOpenTasks).toBe(3)
    expect(result.unassignedOverdueTasks).toBe(1)
    expect(result.rows[0]).toMatchObject({ assigned: 1, openAssigned: 1, overdue: 0 })
  })

  it('counts overdue tasks only when unfinished and treats due today as not overdue', () => {
    const tasks = [
      { id: 'past', assigneeIds: ['a'], dueDate: '2026-10-23', done: false },
      { id: 'today', assigneeIds: ['a'], dueDate: '2026-10-24', done: false },
      { id: 'done-past', assigneeIds: ['a'], dueDate: '2026-10-20', done: true },
      { id: 'unassigned', dueDate: '2026-10-01', done: false }
    ]
    const result = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-10-24')

    expect(result.overdueTasks.map((task) => task.id)).toEqual(['past', 'unassigned'])
    expect(result.overdueAssignments).toBe(1)
    expect(result.rows[0].overdue).toBe(1)
  })

  it('handles empty and malformed assignment fields safely', () => {
    const result = calculateStats(
      [{ id: '1', assigneeIds: null, assigneeId: null, done: false, dueDate: 'invalid' }],
      [{ id: 'a', name: 'An' }],
      '2026-10-24'
    )
    expect(result.rows[0]).toEqual({
      id: 'a',
      name: 'An',
      completed: 0,
      assigned: 0,
      completionRate: null,
      openAssigned: 0,
      overdue: 0
    })
    expect(result.overdueTasks).toEqual([])
    expect(result.dueSoonTasks).toEqual([])
    expect(result.completedThisWeek).toBe(0)
    expect(result.unassignedOpenTasks).toBe(1)
    expect(result.unassignedOverdueTasks).toBe(0)
  })

  it('treats a timed task due earlier today as overdue when the current time is known', () => {
    const tasks = [
      { id: 'passed', dueDate: '2026-11-09', dueTime: '07:00', assigneeIds: ['a'] },
      { id: 'later', dueDate: '2026-11-09', dueTime: '18:00', assigneeIds: ['a'] },
      { id: 'all-day', dueDate: '2026-11-09', assigneeIds: ['a'] },
      { id: 'exactly-now', dueDate: '2026-11-09', dueTime: '09:30', assigneeIds: ['a'] }
    ]
    const stats = calculateStats(tasks, [{ id: 'a', name: 'An' }], '2026-11-09', '09:30')
    expect(stats.overdueTasks.map((task) => task.id)).toEqual(['passed', 'exactly-now'])
    expect(stats.rows[0].overdue).toBe(2)
    // overdue tasks are not also counted as due soon
    expect(stats.dueSoonTasks.map((task) => task.id)).toEqual(['later', 'all-day'])
  })

  it('keeps the whole-day rule when no current time is given', () => {
    const tasks = [{ id: 'passed', dueDate: '2026-11-09', dueTime: '07:00' }]
    const stats = calculateStats(tasks, [], '2026-11-09')
    expect(stats.overdueTasks).toEqual([])
    expect(stats.dueSoonTasks).toHaveLength(1)
  })

  it('counts timed overdue tasks in the unassigned-overdue figure too', () => {
    const tasks = [{ id: 'orphan', dueDate: '2026-11-09', dueTime: '07:00', assigneeIds: ['gone'] }]
    expect(calculateStats(tasks, [], '2026-11-09', '12:00').unassignedOverdueTasks).toBe(1)
  })

  it('does not throw on null task or employee lists', () => {
    expect(() => calculateStats(null, null, '2026-11-09')).not.toThrow()
    expect(calculateStats(null, null, '2026-11-09').rows).toEqual([])
  })
})
