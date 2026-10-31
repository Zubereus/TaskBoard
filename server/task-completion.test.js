import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import completionModule from './task-completion.js'
import dbModule from './db.js'

const { completionPatch } = completionModule
const { JsonCollection } = dbModule

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('task completion timestamps', () => {
  it('records a timestamp when an unfinished task is completed', () => {
    expect(completionPatch({ done: false }, { done: true }, '2026-10-30T06:00:00.000Z')).toEqual({
      done: true,
      completedAt: '2026-10-30T06:00:00.000Z'
    })
  })

  it('preserves the original timestamp when completion is applied again', () => {
    expect(
      completionPatch(
        { done: true, completedAt: '2026-10-29T06:00:00.000Z' },
        { done: true },
        '2026-10-30T06:00:00.000Z'
      )
    ).toEqual({ done: true, completedAt: '2026-10-29T06:00:00.000Z' })
  })

  it('does not invent a timestamp for a legacy completed task', () => {
    expect(completionPatch({ done: true }, { done: true }, '2026-10-30T06:00:00.000Z')).toEqual({
      done: true
    })
  })

  it('clears the timestamp when a task is reopened', () => {
    expect(
      completionPatch(
        { done: true, completedAt: '2026-10-29T06:00:00.000Z' },
        { done: false },
        '2026-10-30T06:00:00.000Z'
      )
    ).toEqual({ done: false, completedAt: null })
  })

  it('records a fresh timestamp after reopening and completing again', () => {
    const reopened = completionPatch(
      { done: true, completedAt: '2026-10-29T06:00:00.000Z' },
      { done: false }
    )
    expect(
      completionPatch(
        { ...reopened, done: false },
        { done: true },
        '2026-10-30T06:00:00.000Z'
      )
    ).toEqual({ done: true, completedAt: '2026-10-30T06:00:00.000Z' })
  })

  it('leaves timestamps untouched for edits unrelated to completion', () => {
    const patch = { title: 'Updated title' }
    expect(completionPatch({ done: true, completedAt: '2026-10-29T06:00:00.000Z' }, patch)).toBe(patch)
  })

  it('persists completion timestamps and preserves them across ordinary edits', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-completion-'))
    tempDirs.push(dir)
    const tasks = new JsonCollection(dir, 'tasks')
    const created = await tasks.insert({ id: 'task-1', title: 'Review', done: false })

    await tasks.update(created.id, completionPatch(created, { done: true }, '2026-10-30T06:00:00.000Z'))
    const completed = await tasks.get(created.id)
    expect(completed).toMatchObject({
      done: true,
      completedAt: '2026-10-30T06:00:00.000Z'
    })

    await tasks.update(created.id, completionPatch(completed, { title: 'Reviewed' }))
    expect(await tasks.get(created.id)).toMatchObject({
      title: 'Reviewed',
      done: true,
      completedAt: '2026-10-30T06:00:00.000Z'
    })

    const afterUndo = await tasks.update(
      created.id,
      completionPatch(await tasks.get(created.id), { done: false })
    )
    expect(afterUndo).toMatchObject({ done: false, completedAt: null })
  })
})
