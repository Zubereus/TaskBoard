import { describe, expect, it, vi } from 'vitest'
import {
  createUndoState,
  nextRecurringTask,
  normalizeReminderDays,
  undoCompletedTask
} from './taskWorkflow'
import { nextOccurrenceDate, normalizeRecurring, formatTimeVN } from './vnDate'

describe('task workflow', () => {
  it('normalizes reminder days, removes duplicates, and rejects invalid values', () => {
    expect(normalizeReminderDays([7, '3', 1, 7, 0, -2, 366, 'x'])).toEqual([7, 3, 1])
    expect(normalizeReminderDays(undefined)).toEqual([])
    expect(normalizeReminderDays(null)).toEqual([])
    expect(normalizeReminderDays([true, false, 1.5, ' 7 '])).toEqual([7, 1])
  })

  it('builds a plain recurring task payload without reactive or legacy fields', () => {
    const task = {
      title: 'Quarterly report',
      tags: [{ text: 'finance' }],
      assigneeId: 'member-1',
      reminderDays: [7, 7, 0],
      dueTime: null,
      recurring: 'quarterly',
      personal: false
    }
    const result = nextRecurringTask(task, '2027-01-24')

    expect(result).toEqual({
      recurrenceSourceId: undefined,
      title: 'Quarterly report',
      tags: [{ text: 'finance', color: 'gray' }],
      dueDate: '2027-01-24',
      dueTime: '',
      priority: undefined,
      recurring: 'quarterly',
      notes: '',
      assigneeIds: ['member-1'],
      reminderDays: [7],
      personal: false,
      alarmEnabled: false
    })

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('preserves alarms on recurring task occurrences', () => {
    expect(nextRecurringTask({ id: 'task-1', title: 'Review', alarmEnabled: true }, '2027-01-25').alarmEnabled).toBe(true)
  })

  it('advances quarterly dates across year boundaries and clamps month ends', () => {
    expect(nextOccurrenceDate('2026-10-24', 'quarterly')).toBe('2027-01-24')
    expect(nextOccurrenceDate('2026-11-30', 'quarterly')).toBe('2027-02-28')
    expect(nextOccurrenceDate('2024-02-29', 'quarterly')).toBe('2024-05-29')
  })

  it('keeps monthly and yearly recurrence anchored to the original date', () => {
    expect(nextOccurrenceDate('2026-02-28', 'monthly', '2026-01-31')).toBe('2026-03-31')
    expect(nextOccurrenceDate('2026-02-28', 'quarterly', '2025-11-30')).toBe('2026-05-30')
    expect(nextOccurrenceDate('2025-02-28', 'yearly', '2024-02-29')).toBe('2026-02-28')
    expect(nextRecurringTask(
      { id: 'task-1', dueDate: '2026-02-28', recurrenceAnchorDate: '2026-01-31' },
      '2026-03-31'
    ).recurrenceAnchorDate).toBe('2026-01-31')
  })

  it('supports every recurrence interval and safely rejects unknown intervals', () => {
    expect(nextOccurrenceDate('2026-01-31', 'daily')).toBe('2026-02-01')
    expect(nextOccurrenceDate('2026-01-31', 'weekly')).toBe('2026-02-07')
    expect(nextOccurrenceDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextOccurrenceDate('2026-01-31', 'quarterly')).toBe('2026-04-30')
    expect(nextOccurrenceDate('2024-02-29', 'yearly')).toBe('2025-02-28')
    expect(nextOccurrenceDate('2026-01-01', 'none')).toBeNull()
    expect(nextOccurrenceDate('2026-01-01', 'weeklyy')).toBeNull()
  })

  it('normalizes legacy recurrence values and formats boundary times', () => {
    expect(normalizeRecurring(true)).toBe('daily')
    expect(normalizeRecurring('quarterly')).toBe('quarterly')
    expect(normalizeRecurring('invalid')).toBe('none')
    expect(normalizeRecurring(null)).toBe('none')
    expect(formatTimeVN('00:00')).toBe('12:00 SA')
    expect(formatTimeVN('12:00')).toBe('12:00 CH')
    expect(formatTimeVN('23:05')).toBe('11:05 CH')
    expect(formatTimeVN('')).toBe('')
  })

  it('creates undo state for a completed recurring task', () => {
    expect(createUndoState({ id: 'task-1', title: 'Report' }, 'task-2')).toEqual({
      id: 'task-1',
      title: 'Report',
      createdNextId: 'task-2',
      recurrenceSourceId: 'task-1'
    })
  })

  it('undoes completion and removes the generated recurring task', async () => {
    const api = { update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(true) }
    await expect(undoCompletedTask(createUndoState({ id: 'task-1', title: 'Report' }, 'task-2'), api)).resolves.toBe(true)
    expect(api.update).toHaveBeenCalledWith('task-1', { done: false })
    expect(api.delete).toHaveBeenCalledWith('task-2')
    expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(api.delete.mock.invocationCallOrder[0])
  })

  it('falls back to the recurrence source when the generated id is missing', async () => {
    const records = [
      { id: 'task-1', title: 'Report', done: true },
      { id: 'task-2', title: 'Report', recurrenceSourceId: 'task-1', done: false },
      { id: 'unrelated', title: 'Other', recurrenceSourceId: 'other', done: false }
    ]
    const api = {
      update: vi.fn().mockImplementation(async (id, patch) => {
        Object.assign(records.find((task) => task.id === id), patch)
      }),
      list: vi.fn().mockResolvedValue(records),
      delete: vi.fn().mockImplementation(async (id) => {
        const index = records.findIndex((task) => task.id === id)
        if (index < 0) return false
        records.splice(index, 1)
        return true
      })
    }

    await undoCompletedTask(createUndoState(records[0]), api)

    expect(records.map((task) => task.id)).toEqual(['task-1', 'unrelated'])
    expect(api.delete).toHaveBeenCalledWith('task-2')
  })

  it('does not delete the source task during fallback cleanup', async () => {
    const api = {
      update: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue([{ id: 'task-1', recurrenceSourceId: 'task-1' }]),
      delete: vi.fn()
    }
    await undoCompletedTask(createUndoState({ id: 'task-1', title: 'Report' }), api)
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('does not delete a next task when undoing a non-recurring task', async () => {
    const api = { update: vi.fn().mockResolvedValue({}), delete: vi.fn() }
    await undoCompletedTask(createUndoState({ id: 'task-1', title: 'One-off' }), api)
    expect(api.update).toHaveBeenCalledOnce()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('returns false and makes no API calls when there is no undo state', async () => {
    const api = { update: vi.fn(), delete: vi.fn() }
    await expect(undoCompletedTask(null, api)).resolves.toBe(false)
    expect(api.update).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('does not delete the generated task if restoring completion fails', async () => {
    const api = {
      update: vi.fn().mockRejectedValue(new Error('update failed')),
      delete: vi.fn()
    }
    await expect(undoCompletedTask(createUndoState({ id: 'task-1', title: 'Report' }, 'task-2'), api)).rejects.toThrow('update failed')
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('propagates delete failures after the original task was restored', async () => {
    const api = {
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockRejectedValue(new Error('delete failed'))
    }
    await expect(undoCompletedTask(createUndoState({ id: 'task-1', title: 'Report' }, 'task-2'), api)).rejects.toThrow(
      'delete failed'
    )
    expect(api.update).toHaveBeenCalledWith('task-1', { done: false })
  })
})
