export function filterTasksForExport(tasks, scope = 'all', includeCompleted = true) {
  const scopedTasks = scope === 'personal'
    ? tasks.filter((task) => task.personal)
    : scope === 'shared'
      ? tasks.filter((task) => !task.personal)
      : tasks
  return includeCompleted ? scopedTasks : scopedTasks.filter((task) => !task.done)
}

export function countTasksForExport(tasks, scope = 'all', includeCompleted = true) {
  return filterTasksForExport(tasks, scope, includeCompleted).length
}
