import { describe, expect, it } from 'vitest'
import personProfileModule from './person-profile.js'

const { reconcilePersonProfile, claimLegacyProfile, listClaimableProfiles, isLegacyEmployeeId } = personProfileModule

class MemoryCollection {
  constructor(records = []) {
    this.records = records.map((record) => ({ ...record }))
  }

  async list() {
    return this.records.map((record) => ({ ...record }))
  }

  async update(id, patch) {
    const index = this.records.findIndex((record) => record.id === id)
    if (index < 0) return null
    this.records[index] = { ...this.records[index], ...patch, id }
    return { ...this.records[index] }
  }

  async remove(id) {
    this.records = this.records.filter((record) => record.id !== id)
  }

  async insert(record) {
    this.records.push({ ...record })
    return { ...record }
  }
}

describe('person profile migration', () => {
  it('moves a unique legacy name to the stable ID and preserves assigned tasks', async () => {
    const employees = new MemoryCollection([{ id: 'legacy-id', name: 'Trang', role: 'Lead' }])
    const tasks = new MemoryCollection([
      { id: 'task-1', assigneeIds: ['legacy-id', 'another-person'] },
      { id: 'task-2', assigneeId: 'legacy-id' }
    ])

    const result = await reconcilePersonProfile(employees, tasks, {
      personId: 'stable-id',
      name: 'Trang'
    })

    expect(await employees.list()).toEqual([{ id: 'stable-id', name: 'Trang', role: 'Lead' }])
    expect(await tasks.list()).toEqual([
      { id: 'task-1', assigneeIds: ['stable-id', 'another-person'], assigneeId: null },
      { id: 'task-2', assigneeIds: ['stable-id'], assigneeId: null }
    ])
    expect(result.migratedEmployeeIds).toEqual(['legacy-id'])
    expect(result.updatedTasks).toHaveLength(2)
  })

  it('merges a leftover legacy duplicate into an existing stable profile', async () => {
    const employees = new MemoryCollection([
      { id: 'stable-id', name: 'Trang' },
      { id: 'legacy-id', name: 'Trang', role: 'Lead' }
    ])
    const tasks = new MemoryCollection([{ id: 'task-1', assigneeIds: ['legacy-id'] }])

    const result = await reconcilePersonProfile(employees, tasks, {
      personId: 'stable-id',
      name: 'Trang'
    })

    expect(await employees.list()).toEqual([{ id: 'stable-id', name: 'Trang', role: 'Lead' }])
    expect((await tasks.list())[0].assigneeIds).toEqual(['stable-id'])
    expect(result.employee.id).toBe('stable-id')
  })

  it('does not guess between multiple people with the same display name', async () => {
    const employees = new MemoryCollection([
      { id: 'legacy-1', name: 'Trang', role: 'Design' },
      { id: 'legacy-2', name: 'Trang', role: 'Sales' }
    ])
    const tasks = new MemoryCollection([{ id: 'task-1', assigneeIds: ['legacy-1'] }])

    await reconcilePersonProfile(employees, tasks, { personId: 'stable-id', name: 'Trang' })

    expect(await employees.list()).toHaveLength(3)
    expect((await tasks.list())[0].assigneeIds).toEqual(['legacy-1'])
  })
})

const PERSON_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

describe('claiming a legacy profile', () => {
  it('lists only entries without a device-generated ID as claimable', async () => {
    const employees = new MemoryCollection([
      { id: 'lq3k9x1abc', name: 'Nguyễn Văn A', role: 'Dev' },
      { id: PERSON_ID, name: 'DESKTOP-9KQ2' }
    ])
    expect(await listClaimableProfiles(employees)).toEqual([
      { id: 'lq3k9x1abc', name: 'Nguyễn Văn A', role: 'Dev' }
    ])
    expect(isLegacyEmployeeId(PERSON_ID)).toBe(false)
  })

  it('moves tasks to the stable ID even when the names differ', async () => {
    const employees = new MemoryCollection([
      { id: 'legacy-1', name: 'Nguyễn Văn A', role: 'Dev' },
      { id: PERSON_ID, name: 'DESKTOP-9KQ2', role: '' }
    ])
    const tasks = new MemoryCollection([
      { id: 't1', assigneeIds: ['legacy-1', 'other'] },
      { id: 't2', assigneeId: 'legacy-1' },
      { id: 't3', assigneeIds: ['other'] }
    ])

    const result = await claimLegacyProfile(employees, tasks, { personId: PERSON_ID, legacyId: 'legacy-1' })

    expect(await employees.list()).toEqual([{ id: PERSON_ID, name: 'Nguyễn Văn A', role: 'Dev' }])
    expect((await tasks.list()).map((task) => task.assigneeIds)).toEqual([
      [PERSON_ID, 'other'],
      [PERSON_ID],
      ['other']
    ])
    expect(result.migratedEmployeeIds).toEqual(['legacy-1'])
    expect(result.updatedTasks).toHaveLength(2)
    expect(result.employee.name).toBe('Nguyễn Văn A')
  })

  it('creates the device profile when it does not exist yet', async () => {
    const employees = new MemoryCollection([{ id: 'legacy-1', name: 'Trang' }])
    const tasks = new MemoryCollection([{ id: 't1', assigneeIds: ['legacy-1'] }])
    await claimLegacyProfile(employees, tasks, { personId: PERSON_ID, legacyId: 'legacy-1' })
    expect(await employees.list()).toEqual([{ id: PERSON_ID, name: 'Trang', role: '' }])
  })

  it('rejects a second claim of the same entry and device-owned profiles', async () => {
    const employees = new MemoryCollection([{ id: 'legacy-1', name: 'Trang' }, { id: PERSON_ID, name: 'PC' }])
    const tasks = new MemoryCollection([])
    await claimLegacyProfile(employees, tasks, { personId: PERSON_ID, legacyId: 'legacy-1' })

    await expect(
      claimLegacyProfile(employees, tasks, { personId: 'ffffffff-0000-4000-8000-000000000000', legacyId: 'legacy-1' })
    ).rejects.toThrow('đã được người khác nhận')
    await expect(
      claimLegacyProfile(employees, tasks, { personId: 'ffffffff-0000-4000-8000-000000000000', legacyId: PERSON_ID })
    ).rejects.toThrow('thuộc về một thiết bị')
  })

  it('truncates long names to the display-name limit', async () => {
    const employees = new MemoryCollection([{ id: 'legacy-1', name: 'x'.repeat(60) }])
    const result = await claimLegacyProfile(employees, new MemoryCollection([]), {
      personId: PERSON_ID,
      legacyId: 'legacy-1'
    })
    expect(result.employee.name).toHaveLength(40)
  })
})
