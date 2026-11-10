import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonCollection } from './db.js'

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})
describe('JsonCollection task and member storage', () => {
  it('creates and persists a task with a generated id', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-test-'))
    tempDirs.push(dir)
    const tasks = new JsonCollection(dir, 'tasks')
    const created = await tasks.insert({ title: 'Prepare report', done: false })

    expect(created.id).toEqual(expect.any(String))
    expect(await tasks.get(created.id)).toMatchObject({ title: 'Prepare report', done: false })
    expect(await tasks.list()).toHaveLength(1)
  })

  it('creates, updates, and removes a member without changing its id', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-test-'))
    tempDirs.push(dir)
    const members = new JsonCollection(dir, 'employees')
    const created = await members.insert({ id: 'member-1', name: 'An', role: 'Lead' })
    const updated = await members.update(created.id, { role: 'Manager' })

    expect(updated).toEqual({ id: 'member-1', name: 'An', role: 'Manager' })
    expect(await members.remove(created.id)).toBe(true)
    expect(await members.get(created.id)).toBeNull()
    expect(await members.remove(created.id)).toBe(false)
  })

  it('reports malformed JSON instead of silently resetting data', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-test-'))
    tempDirs.push(dir)
    await fs.writeFile(path.join(dir, 'tasks.json'), '{bad json', 'utf8')
    const tasks = new JsonCollection(dir, 'tasks')

    await expect(tasks.list()).rejects.toThrow('Tệp dữ liệu bị lỗi')
  })
})

describe('JsonCollection concurrent writes', () => {
  async function collection() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-test-'))
    tempDirs.push(dir)
    return new JsonCollection(dir, 'tasks')
  }

  it('keeps every record when many inserts run at the same time', async () => {
    const tasks = await collection()
    await Promise.all(Array.from({ length: 25 }, (_, i) => tasks.insert({ id: `t${i}`, title: `Task ${i}` })))
    expect(await tasks.list()).toHaveLength(25)
  })

  it('does not lose an update that runs alongside inserts', async () => {
    const tasks = await collection()
    await tasks.insert({ id: 'keep', title: 'old', done: false })
    await Promise.all([
      tasks.insert({ id: 'a', title: 'A' }),
      tasks.update('keep', { done: true }),
      tasks.insert({ id: 'b', title: 'B' }),
      tasks.remove('a')
    ])
    const ids = (await tasks.list()).map((task) => task.id).sort()
    expect(ids).toEqual(['b', 'keep'])
    expect(await tasks.get('keep')).toMatchObject({ done: true })
  })

  it('applies exclusive work in order and keeps going after one fails', async () => {
    const tasks = await collection()
    const order = []
    const first = tasks.exclusive(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first')
    })
    const failing = tasks.exclusive(async () => {
      order.push('failing')
      throw new Error('boom')
    })
    const last = tasks.exclusive(async () => {
      order.push('last')
      return 'done'
    })
    await first
    await expect(failing).rejects.toThrow('boom')
    await expect(last).resolves.toBe('done')
    expect(order).toEqual(['first', 'failing', 'last'])
  })
})
