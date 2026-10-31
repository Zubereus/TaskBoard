function completionPatch(existing, patch, completedAt = new Date().toISOString()) {
  if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'done')) return patch

  if (patch.done === true) {
    if (existing?.done) {
      return existing.completedAt
        ? { ...patch, completedAt: existing.completedAt }
        : patch
    }
    return { ...patch, completedAt }
  }

  if (patch.done === false) return { ...patch, completedAt: null }
  return patch
}

module.exports = { completionPatch }
