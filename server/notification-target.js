function assigneeIdsOf(task) {
  if (Array.isArray(task?.assigneeIds)) return task.assigneeIds
  return task?.assigneeId ? [task.assigneeId] : []
}

function isTaskAssignedTo(task, personId) {
  return Boolean(personId) && assigneeIdsOf(task).includes(personId)
}

// A personal task is stored only on the machine that created it, so it always
// targets this install even though it has no assignees. Shared tasks still
// need this install's stable person ID in their assignee list.
function isTaskForPerson(task, personId) {
  return Boolean(task?.personal) || isTaskAssignedTo(task, personId)
}

module.exports = { assigneeIdsOf, isTaskAssignedTo, isTaskForPerson }
