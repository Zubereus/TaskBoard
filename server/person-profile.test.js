import { describe, expect, it } from 'vitest'
import personProfileModule from './person-profile.js'

const { reconcilePersonProfile } = personProfileModule

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
