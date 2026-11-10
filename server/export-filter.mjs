export function filterTasksForExport(tasks, scope = 'all', includeCompleted = true) {
  const scopedTasks = scope === 'personal'
    ? tasks.filter((task) => task.personal)
    : scope === 'shared'
      ? tasks.filter((task) => !task.personal)
      : tasks
  return includeCompleted ? scopedTasks : scopedTasks.filter((task) => !task.done)
}

export function isTaskOverdueForExport(task, today, nowTime) {
  if (task.done || !task.dueDate) return false
  if (task.dueDate < today) return true
  return task.dueDate === today && Boolean(task.dueTime) && task.dueTime <= nowTime
}

export function filterOverdueTasks(tasks, today, nowTime) {
  return tasks.filter((task) => isTaskOverdueForExport(task, today, nowTime))
}

export function countTasksForExport(
  tasks,
  scope = 'all',
  includeCompleted = true,
  { onlyOverdue = false, today, nowTime } = {}
) {
  const filtered = filterTasksForExport(tasks, scope, onlyOverdue ? false : includeCompleted)
  return onlyOverdue ? filterOverdueTasks(filtered, today, nowTime).length : filtered.length
}
