import { describe, expect, it } from 'vitest'
import { buildAssigneeBreakdown, generateTasksDocx } from './docx-export.js'

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
})
