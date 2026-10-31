function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
}

export function matchesTaskSearch(task, query, employees = []) {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const assigneeIds = Array.isArray(task.assigneeIds)
    ? task.assigneeIds
    : task.assigneeId
      ? [task.assigneeId]
      : []
  const assigneeNames = employees
    .filter((employee) => assigneeIds.includes(employee.id))
    .map((employee) => employee.name)
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || '')
    ? task.dueDate.split('-').reverse().join('/')
    : ''
  const searchableText = normalizeSearchText([
    task.title,
    task.notes,
    task.dueDate,
    dueDate,
    task.dueTime,
    ...(Array.isArray(task.tags) ? task.tags.map((tag) => tag.text) : []),
    ...assigneeNames
  ].join(' '))

  return terms.every((term) => searchableText.includes(term))
}
