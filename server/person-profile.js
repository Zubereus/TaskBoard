async function reconcilePersonProfile(employees, tasks, { personId, name }) {
  const people = await employees.list()
  const current = people.find((person) => person.id === personId)
  const normalizedName = String(name || '').trim().toLocaleLowerCase()
  const legacyMatches = people.filter(
    (person) =>
      person.id !== personId &&
      String(person.name || '').trim().toLocaleLowerCase() === normalizedName
  )
  const legacy = legacyMatches.length === 1 ? legacyMatches[0] : null
  const legacyId = legacy?.id

  const affectedTasks = legacyId
    ? (await tasks.list()).filter((task) =>
        (task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])).includes(legacyId)
      )
    : []
  const updatedTasks = []
  for (const task of affectedTasks) {
    const ids = task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])
    const assigneeIds = [...new Set(ids.map((id) => (id === legacyId ? personId : id)))]
    updatedTasks.push(await tasks.update(task.id, { assigneeIds, assigneeId: null }))
  }

  let employee
  if (current) {
    employee = await employees.update(personId, {
      name,
      ...(legacy?.role && !current.role ? { role: legacy.role } : {})
    })
  } else if (legacy) {
    await employees.remove(legacyId)
    employee = await employees.insert({ ...legacy, id: personId, name })
  } else {
    employee = await employees.insert({ id: personId, name, role: '' })
  }

  if (current && legacy) await employees.remove(legacyId)

  return {
    employee,
    migratedEmployeeIds: legacyId ? [legacyId] : [],
    updatedTasks
  }
}

module.exports = { reconcilePersonProfile }
