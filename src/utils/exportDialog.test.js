import { describe, expect, it } from 'vitest'
import {
  exportButtonDisabled,
  groupByMemberForScope,
  isGroupByMemberDisabled
} from './exportDialog'

describe('Word export dialog options', () => {
  it('disables and resets member grouping for personal tasks', () => {
    expect(isGroupByMemberDisabled('personal')).toBe(true)
    expect(isGroupByMemberDisabled('all')).toBe(false)
    expect(isGroupByMemberDisabled('shared')).toBe(false)
    expect(groupByMemberForScope('personal', true)).toBe(false)
    expect(groupByMemberForScope('all', true)).toBe(true)
    expect(groupByMemberForScope('shared', true)).toBe(true)
  })

  it('disables saving when there are no tasks or an export is in progress', () => {
    expect(exportButtonDisabled(0, false, false)).toBe(true)
    expect(exportButtonDisabled(2, true, false)).toBe(true)
    expect(exportButtonDisabled(2, false, true)).toBe(true)
    expect(exportButtonDisabled(2, false, false)).toBe(false)
  })
})
