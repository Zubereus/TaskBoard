import { describe, expect, it } from 'vitest'
import { canDeleteTask, canEditTask, canToggleTask } from './taskPermissions'

describe('task permissions', () => {
  it('lets clients fully manage their own personal tasks', () => {
    const personalTask = { personal: true, done: true }

    expect(canEditTask(personalTask, true)).toBe(true)
    expect(canDeleteTask(personalTask, true)).toBe(true)
    expect(canToggleTask(personalTask, true)).toBe(true)
  })

  it('lets clients complete but not edit or delete shared tasks', () => {
    const openSharedTask = { personal: false, done: false }
    const completedSharedTask = { personal: false, done: true }

    expect(canEditTask(openSharedTask, true)).toBe(false)
    expect(canDeleteTask(openSharedTask, true)).toBe(false)
    expect(canToggleTask(openSharedTask, true)).toBe(true)
    expect(canToggleTask(completedSharedTask, true)).toBe(false)
  })

  it('lets the host manage both personal and shared tasks', () => {
    for (const task of [{ personal: true }, { personal: false }]) {
      expect(canEditTask(task, false)).toBe(true)
      expect(canDeleteTask(task, false)).toBe(true)
      expect(canToggleTask(task, false)).toBe(true)
    }
  })
})
