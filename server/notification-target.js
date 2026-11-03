function assigneeIdsOf(task) {
  if (Array.isArray(task?.assigneeIds)) return task.assigneeIds
  return task?.assigneeId ? [task.assigneeId] : []
}

function isTaskAssignedTo(task, personId) {
  return Boolean(personId) && assigneeIdsOf(task).includes(personId)
}

module.exports = { assigneeIdsOf, isTaskAssignedTo }
