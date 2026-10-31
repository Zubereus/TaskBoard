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
