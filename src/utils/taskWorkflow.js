export function normalizeReminderDays(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(Number))]
    .filter((days) => Number.isInteger(days) && days > 0 && days <= 365)
    .sort((a, b) => b - a)
}

export function nextRecurringTask(task, nextDate) {
  const payload = {
    recurrenceSourceId: task.id,
    title: task.title,
    tags: (task.tags || []).map((tag) => ({ text: tag.text, color: tag.color || 'gray' })),
    dueDate: nextDate,
    dueTime: task.dueTime || '',
    priority: task.priority,
    recurring: task.recurring,
    notes: task.notes || '',
    assigneeIds: [...(task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []))],
    reminderDays: normalizeReminderDays(task.reminderDays),
    personal: !!task.personal,
    alarmEnabled: !!task.alarmEnabled
  }
  const anchorDate = task.recurrenceAnchorDate || task.dueDate
  if (anchorDate) payload.recurrenceAnchorDate = anchorDate
  return payload
}

export function createUndoState(task, createdNextId = null) {
  return {
    id: task.id,
    title: task.title,
    createdNextId,
    recurrenceSourceId: task.id
  }
}

export async function undoCompletedTask(state, api) {
  if (!state) return false
  await api.update(state.id, { done: false })
  let deleted = false
  if (state.createdNextId) deleted = await api.delete(state.createdNextId)
  if (!deleted && api.list && state.recurrenceSourceId) {
    const generatedTasks = (await api.list()).filter(
      (task) => task.recurrenceSourceId === state.recurrenceSourceId && task.id !== state.id
    )
    for (const task of generatedTasks) await api.delete(task.id)
  }
  return true
}
