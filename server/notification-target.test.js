import { describe, expect, it } from 'vitest'
import notificationTargetModule from './notification-target.js'

const { assigneeIdsOf, isTaskAssignedTo, isTaskForPerson } = notificationTargetModule

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

describe('notification targeting for this install', () => {
  it('always targets personal tasks, even without assignees', () => {
    expect(isTaskForPerson({ personal: true, assigneeIds: [] }, 'person-1')).toBe(true)
    expect(isTaskForPerson({ personal: true }, '')).toBe(true)
  })

  it('still requires the stable ID for shared tasks', () => {
    expect(isTaskForPerson({ assigneeIds: ['person-1'] }, 'person-1')).toBe(true)
    expect(isTaskForPerson({ assigneeIds: ['old-id'] }, 'person-1')).toBe(false)
    expect(isTaskForPerson({ assigneeIds: [] }, 'person-1')).toBe(false)
  })
})
