import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonCollection } from './db.js'

const tempDirs = []

afterEach(async () => {
  vi.restoreAllMocks()
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

describe('JsonCollection file safety', () => {
  async function freshDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-test-'))
    tempDirs.push(dir)
    return dir
  }

  it('never lets reading a missing file overwrite or break a concurrent first write', async () => {
    // Regression: the read created the file with an unlocked write that shared a
    // temp file name with the real write, so one of them threw ENOENT or the
    // empty list replaced the real data.
    for (let trial = 0; trial < 60; trial = trial + 1) {
      const dir = await freshDir()
      const employees = new JsonCollection(dir, 'employees')
      const [poll, write] = await Promise.allSettled([
        employees.list(),
        employees.exclusive(() => employees._write([{ id: 'real', name: 'from sync' }]))
      ])
      expect(poll.status).toBe('fulfilled')
      expect(write.status).toBe('fulfilled')
      expect(await employees.list()).toEqual([{ id: 'real', name: 'from sync' }])
    }
  })

  it('still creates an empty collection file on first read', async () => {
    const dir = await freshDir()
    const tasks = new JsonCollection(dir, 'tasks')
    expect(await tasks.list()).toEqual([])
    expect(JSON.parse(await fs.readFile(path.join(dir, 'tasks.json'), 'utf-8'))).toEqual([])
  })

  it('lets unlocked writes in the same millisecond coexist', async () => {
    const dir = await freshDir()
    const tasks = new JsonCollection(dir, 'tasks')
    await Promise.all([tasks._write([{ id: 'a' }]), tasks._write([{ id: 'b' }])])
    expect(await tasks.list()).toHaveLength(1)
    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('retries the transient rename errors Windows raises while a scanner holds the file', async () => {
    const dir = await freshDir()
    const tasks = new JsonCollection(dir, 'tasks')
    const realRename = fs.rename
    let failures = 2
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (failures > 0) {
        failures = failures - 1
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      }
      return realRename(from, to)
    })
    await tasks.insert({ id: 'kept', title: 'survives a busy file' })
    expect(failures).toBe(0)
    expect(await tasks.list()).toEqual([{ id: 'kept', title: 'survives a busy file' }])
  })

  it('gives up on a persistent rename error, reports it, and leaves no temp file behind', async () => {
    const dir = await freshDir()
    const tasks = new JsonCollection(dir, 'tasks')
    await tasks.insert({ id: 'before' })
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))
    await expect(tasks.insert({ id: 'after' })).rejects.toThrow('busy')
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    vi.restoreAllMocks()
    expect((await tasks.list()).map((task) => task.id)).toEqual(['before'])
  })

  it('does not retry errors that are not transient', async () => {
    const dir = await freshDir()
    const tasks = new JsonCollection(dir, 'tasks')
    const spy = vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    await expect(tasks.insert({ id: 'x' })).rejects.toThrow('disk full')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})