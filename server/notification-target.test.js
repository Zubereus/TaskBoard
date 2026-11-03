import { describe, expect, it } from 'vitest'
import notificationTargetModule from './notification-target.js'

const { assigneeIdsOf, isTaskAssignedTo } = notificationTargetModule

describe('notification assignment targeting', () => {
  it('only targets tasks assigned to this person', () => {
    expect(isTaskAssignedTo({ assigneeIds: ['person-1'] }, 'person-1')).toBe(true)
    expect(isTaskAssignedTo({ assigneeIds: ['person-2'] }, 'person-1')).toBe(false)
  })

  it('supports multiple and legacy single assignees', () => {
    expect(isTaskAssignedTo({ assigneeIds: ['person-1', 'person-2'] }, 'person-2')).toBe(true)
    expect(isTaskAssignedTo({ assigneeId: 'person-1' }, 'person-1')).toBe(true)
  })

  it('does not notify anyone for unassigned tasks or without an identity', () => {
    expect(isTaskAssignedTo({ title: 'Unassigned' }, 'person-1')).toBe(false)
    expect(isTaskAssignedTo({ assigneeIds: ['person-1'] }, '')).toBe(false)
    expect(assigneeIdsOf({ assigneeIds: [] })).toEqual([])
  })
})
