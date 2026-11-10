import { describe, expect, it } from 'vitest'
import {
  buildAssigneeBreakdown,
  generateTasksDocx
} from './docx-export.js'
import {
  countTasksForExport,
  filterOverdueTasks,
  filterTasksForExport
} from './export-filter.mjs'

describe('Word export assignee breakdown', () => {
  const employees = [
    { id: 'a', name: 'An' },
    { id: 'b', name: 'Bình' },
    { id: 'c', name: 'Chi' }
  ]

  it('lists pending tasks under every assigned member and excludes unassigned work', () => {
    const tasks = [
      { title: 'Shared report', assigneeIds: ['a', 'b'], dueDate: '2026-10-30', dueTime: '14:00', done: false },
      { title: 'Completed task', assigneeId: 'a', done: true },
      { title: 'Unassigned task', assigneeIds: [], done: false }
    ]

    expect(buildAssigneeBreakdown(tasks, employees)).toEqual([
      {
        name: 'An',
        tasks: [{ title: 'Shared report', done: false, due: '14:00  30/10/2026' }]
      },
      {
        name: 'Bình',
        tasks: [{ title: 'Shared report', done: false, due: '14:00  30/10/2026' }]
      }
    ])
  })

  it('includes completed tasks when the full task report is selected', () => {
    const result = buildAssigneeBreakdown(
      [
        { title: 'Open item', assigneeIds: ['a'], done: false },
        { title: 'Finished item', assigneeIds: ['a'], done: true }
      ],
      employees,
      false
    )

    expect(result[0].tasks).toEqual([
      { title: 'Open item', done: false, due: '' },
      { title: 'Finished item', done: true, due: '' }
    ])
  })

  it('generates a Word document with the optional member breakdown enabled', async () => {
    const document = await generateTasksDocx(
      [{ title: 'Prepare report', assigneeIds: ['a'], dueDate: '2026-10-30', done: false }],
      employees,
      { onlyPending: true, includeAssigneeBreakdown: true }
    )

    expect(document.subarray(0, 2).toString()).toBe('PK')
  })

  it('keeps per-member task breakdown aligned with overdue-only exports', async () => {
    const tasks = [
      { title: 'Late shared task', assigneeIds: ['a', 'b'], dueDate: '2026-11-09', done: false },
      { title: 'Not overdue', assigneeIds: ['a'], dueDate: '2026-11-10', dueTime: '15:00', done: false },
      { title: 'Completed late task', assigneeIds: ['a'], dueDate: '2026-11-09', done: true },
      { title: 'Unassigned late task', dueDate: '2026-11-09', done: false }
    ]
    const filtered = filterOverdueTasks(
      filterTasksForExport(tasks, 'all', false),
      '2026-11-10',
      '14:00'
    )

    expect(buildAssigneeBreakdown(filtered, employees, false)).toEqual([
      { name: 'An', tasks: [{ title: 'Late shared task', done: false, due: '09/11/2026' }] },
      { name: 'Bình', tasks: [{ title: 'Late shared task', done: false, due: '09/11/2026' }] }
    ])

    const document = await generateTasksDocx(filtered, employees, {
      onlyPending: false,
      onlyOverdue: true,
      nowTime: '14:00',
      includeAssigneeBreakdown: true
    })
    expect(document.subarray(0, 2).toString()).toBe('PK')
  })
})

describe('Word export scope', () => {
  const tasks = [
    { id: 'personal-open', personal: true, done: false },
    { id: 'personal-done', personal: true, done: true },
    { id: 'shared-open', personal: false, done: false },
    { id: 'shared-done', personal: false, done: true },
    { id: 'legacy-shared-open', done: false },
    { id: 'legacy-shared-done', done: true }
  ]

  it.each([
    ['all', false, 3],
    ['all', true, 6],
    ['personal', false, 1],
    ['personal', true, 2],
    ['shared', false, 2],
    ['shared', true, 4]
  ])('counts %s scope with includeCompleted=%s', (scope, includeCompleted, count) => {
    expect(countTasksForExport(tasks, scope, includeCompleted)).toBe(count)
    expect(filterTasksForExport(tasks, scope, includeCompleted)).toHaveLength(count)
  })
})
