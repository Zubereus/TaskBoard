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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NAME_LENGTH = 40

// Person profiles created by this app use crypto.randomUUID(). Every employee
// created before the ID-based switch (or added by hand in the Team tab) has a
// short base36 ID instead, and is waiting for someone to claim it.
function isLegacyEmployeeId(id) {
  return !UUID_PATTERN.test(String(id || ''))
}

function idsOf(task) {
  return task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])
}

async function listClaimableProfiles(employees) {
  return (await employees.list())
    .filter((person) => isLegacyEmployeeId(person.id))
    .map(({ id, name, role }) => ({ id, name: name || '', role: role || '' }))
}

// Explicit counterpart of reconcilePersonProfile: the person picks which old
// employee entry is theirs, so no name matching is involved. The old entry is
// merged into this device's profile and its tasks move to the stable ID.
async function claimLegacyProfile(employees, tasks, { personId, legacyId }) {
  if (!personId || !legacyId) throw new Error('Thiếu thông tin để nhận hồ sơ.')
  if (personId === legacyId || !isLegacyEmployeeId(legacyId)) {
    throw new Error('Hồ sơ này thuộc về một thiết bị nên không thể nhận.')
  }

  const people = await employees.list()
  const legacy = people.find((person) => person.id === legacyId)
  if (!legacy) throw new Error('Hồ sơ này không còn tồn tại hoặc đã được người khác nhận.')

  const current = people.find((person) => person.id === personId)
  const name = String(legacy.name || '').trim().slice(0, MAX_NAME_LENGTH) || current?.name || 'Thành viên'

  const updatedTasks = []
  for (const task of (await tasks.list()).filter((item) => idsOf(item).includes(legacyId))) {
    const assigneeIds = [...new Set(idsOf(task).map((id) => (id === legacyId ? personId : id)))]
    updatedTasks.push(await tasks.update(task.id, { assigneeIds, assigneeId: null }))
  }

  const employee = current
    ? await employees.update(personId, {
        name,
        ...(legacy.role && !current.role ? { role: legacy.role } : {})
      })
    : await employees.insert({ id: personId, name, role: legacy.role || '' })
  await employees.remove(legacyId)

  return { employee, migratedEmployeeIds: [legacyId], updatedTasks }
}

module.exports = {
  reconcilePersonProfile,
  claimLegacyProfile,
  listClaimableProfiles,
  isLegacyEmployeeId
}
