import { addDaysStr, daysBetween, isoWeekday, parseDateStr, VN_TZ } from './vnDate'

export function assigneesOf(task) {
  return task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])
}

export function calculateStats(tasks = [], employees = [], today) {
  const validToday = parseDateStr(today)
  const weekStart = validToday ? addDaysStr(today, -(isoWeekday(today) - 1)) : null
  const sharedTasks = tasks.filter((task) => !task.personal)
  const employeeIds = new Set(employees.map((employee) => employee.id))
  const rows = employees
    .map((employee) => {
      const assigned = sharedTasks.filter((task) => assigneesOf(task).includes(employee.id))
      const completed = assigned.filter((task) => task.done).length
      return {
        id: employee.id,
        name: employee.name,
        completed,
        assigned: assigned.length,
        completionRate: assigned.length ? completed / assigned.length : null,
        openAssigned: assigned.filter((task) => !task.done).length,
        overdue: assigned.filter(
          (task) => !task.done && task.dueDate && daysBetween(today, task.dueDate) < 0
        ).length
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))

  const overdueTasks = tasks.filter(
    (task) => !task.done && task.dueDate && daysBetween(today, task.dueDate) < 0
  )
  const openTasks = tasks.filter((task) => !task.done)
  const unassignedOpenTasks = sharedTasks.filter(
    (task) => !task.done && !assigneesOf(task).some((id) => employeeIds.has(id))
  )
  const unassignedOverdueTasks = sharedTasks.filter(
    (task) => !task.done && task.dueDate &&
      daysBetween(today, task.dueDate) < 0 &&
      !assigneesOf(task).some((id) => employeeIds.has(id))
  )
  const dueSoonTasks = openTasks.filter((task) => {
    const daysUntilDue = task.dueDate ? daysBetween(today, task.dueDate) : null
    return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7
  })
  const completedThisWeek = weekStart
    ? tasks.filter((task) => {
        if (!task.done || !task.completedAt) return false
        const completedAt = new Date(task.completedAt)
        if (!Number.isFinite(completedAt.getTime())) return false
        const completedDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: VN_TZ,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(completedAt)
        return completedDate >= weekStart && completedDate <= today
      }).length
    : 0

  return {
    rows,
    totalCompleted: rows.reduce((sum, row) => sum + row.completed, 0),
    uniqueCompletedTasks: tasks.filter((task) => task.done).length,
    completedThisWeek,
    openTasks,
    unassignedOpenTasks: unassignedOpenTasks.length,
    unassignedOverdueTasks: unassignedOverdueTasks.length,
    dueSoonTasks,
    overdueTasks,
    overdueAssignments: rows.reduce((sum, row) => sum + row.overdue, 0)
  }
}
