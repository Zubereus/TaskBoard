// Tracks whether the person is at the machine, from signals that main.js feeds
// in (screen lock/unlock, suspend, and polled system idle time). It never reads
// the clock itself, so it can be tested with fake timestamps.
//
// `returned` events are only reported after a real absence (default 5 minutes),
// so locking the screen for a moment does not trigger a "while you were away"
// summary.

function createPresenceTracker({
  idleAfterSeconds = 10 * 60,
  activeBelowSeconds = 30,
  minAwayMs = 5 * 60 * 1000
} = {}) {
  let awaySince = null
  let locked = false

  const leave = (at) => {
    awaySince = awaySince === null ? at : awaySince
  }

  const back = (now) => {
    if (awaySince === null) return null
    const since = awaySince
    awaySince = null
    return now - since >= minAwayMs ? { awaySince: since, awayMs: now - since } : null
  }

  return {
    lock(now) {
      locked = true
      leave(now)
    },
    unlock(now) {
      locked = false
      return back(now)
    },
    suspend(now) {
      leave(now)
    },
    // Resuming from sleep does not mean anyone is at the desk (it may be a
    // scheduled wake-up), so presence is decided by unlock or by input.
    sampleIdle(idleSeconds, now) {
      if (idleSeconds >= idleAfterSeconds) {
        leave(now - idleSeconds * 1000)
        return null
      }
      return !locked && idleSeconds < activeBelowSeconds ? back(now) : null
    },
    isAway() {
      return awaySince !== null
    }
  }
}

module.exports = { createPresenceTracker }
