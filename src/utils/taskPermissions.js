export function canEditTask(task, clientMode) {
  return !clientMode || Boolean(task.personal)
}

export function canDeleteTask(task, clientMode) {
  return !clientMode || Boolean(task.personal)
}

export function canToggleTask(task, clientMode) {
  return !clientMode || Boolean(task.personal) || !task.done
}
