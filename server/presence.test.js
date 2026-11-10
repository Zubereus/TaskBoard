import { describe, expect, it } from 'vitest'
import presenceModule from './presence.js'

const { createPresenceTracker } = presenceModule
const MIN = 60 * 1000

describe('presence tracker', () => {
  it('reports a return after a long lock/unlock', () => {
    const presence = createPresenceTracker()
    presence.lock(0)
    expect(presence.unlock(30 * MIN)).toEqual({ awaySince: 0, awayMs: 30 * MIN })
    expect(presence.isAway()).toBe(false)
  })

  it('ignores short absences', () => {
    const presence = createPresenceTracker()
    presence.lock(0)
    expect(presence.unlock(2 * MIN)).toBeNull()
  })

  it('treats long idle time followed by input as an absence that began when idle started', () => {
    const presence = createPresenceTracker()
    // 20 minutes idle observed at t = 20 min, so the person left at t = 0
    expect(presence.sampleIdle(20 * 60, 20 * MIN)).toBeNull()
    expect(presence.isAway()).toBe(true)
    expect(presence.sampleIdle(5, 21 * MIN)).toEqual({ awaySince: 0, awayMs: 21 * MIN })
  })

  it('keeps the earliest departure when several signals overlap', () => {
    const presence = createPresenceTracker()
    presence.suspend(10 * MIN)
    presence.lock(12 * MIN)
    presence.sampleIdle(30 * 60, 40 * MIN)
    expect(presence.unlock(50 * MIN)).toEqual({ awaySince: 10 * MIN, awayMs: 40 * MIN })
  })

  it('does not report a return from input while the screen is still locked', () => {
    const presence = createPresenceTracker()
    presence.lock(0)
    expect(presence.sampleIdle(1, 30 * MIN)).toBeNull()
    expect(presence.isAway()).toBe(true)
    expect(presence.unlock(31 * MIN)).not.toBeNull()
  })

  it('reports each absence only once', () => {
    const presence = createPresenceTracker()
    presence.lock(0)
    expect(presence.unlock(30 * MIN)).not.toBeNull()
    expect(presence.sampleIdle(1, 31 * MIN)).toBeNull()
    expect(presence.unlock(32 * MIN)).toBeNull()
  })

  it('stays quiet while the person is simply working', () => {
    const presence = createPresenceTracker()
    expect(presence.sampleIdle(3, MIN)).toBeNull()
    expect(presence.sampleIdle(120, 2 * MIN)).toBeNull()
    expect(presence.isAway()).toBe(false)
  })
})
