import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LanSyncManager } from './lan-sync.js'
import { JsonCollection } from './db.js'

class MemoryCollection {
  constructor(records = []) {
    this.records = records.map((record) => ({ ...record }))
    this.nextId = 1
  }

  async list() {
    return this.records.map((record) => ({ ...record }))
  }

  async get(id) {
    const record = this.records.find((item) => item.id === id)
    return record ? { ...record } : null
  }

  async insert(record) {
    const saved = { id: record.id || `generated-${this.nextId++}`, ...record }
    this.records.push(saved)
    return { ...saved }
  }

  async update(id, patch) {
    const index = this.records.findIndex((item) => item.id === id)
    if (index < 0) return null
    this.records[index] = { ...this.records[index], ...patch, id }
    return { ...this.records[index] }
  }

  async remove(id) {
    const before = this.records.length
    this.records = this.records.filter((item) => item.id !== id)
    return this.records.length !== before
  }

  async _write(records) {
    this.records = records.map((record) => ({ ...record }))
  }
}

function createDb(tasks = [], employees = []) {
  return {
    tasks: new MemoryCollection(tasks),
    employees: new MemoryCollection(employees)
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitFor(predicate, timeout = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for LAN state')
}

describe('LAN sync integration', () => {
  const managers = []

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.stopAll()))
  })

  it('handshakes and syncs shared data while preserving client personal data', async () => {
    const host = new LanSyncManager(
      createDb([{ id: 'shared-1', title: 'Shared task' }], [{ id: 'member-1', name: 'Lan A' }])
    )
    const client = new LanSyncManager(
      createDb([{ id: 'local-1', title: 'Local task', personal: true }], [{ id: 'old', name: 'Old member' }])
    )
    managers.push(host, client)
    const port = await findFreePort()

    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected)

    await waitFor(async () => {
      const tasks = await client.db.tasks.list()
      const employees = await client.db.employees.list()
      return tasks.some((task) => task.id === 'shared-1') && employees.some((employee) => employee.id === 'member-1')
    })

    expect(await client.db.tasks.list()).toEqual(
      expect.arrayContaining([
        { id: 'shared-1', title: 'Shared task' },
        { id: 'local-1', title: 'Local task', personal: true }
      ])
    )
    expect(await client.db.employees.list()).toEqual(
      expect.arrayContaining([
        { id: 'member-1', name: 'Lan A' },
        { id: client.clientInstanceId, name: client.deviceName, role: '' }
      ])
    )
  })

  it('registers clients by stable identity and updates their roster name after rename', async () => {
    const host = new LanSyncManager(createDb(
      [{ id: 'legacy-task', assigneeIds: ['legacy-person'] }],
      [{ id: 'legacy-person', name: 'Lan A', role: 'Lead' }]
    ))
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    client.setClientIdentity('person-1')
    client.setDeviceName('Lan A')

    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(async () =>
      (await host.db.employees.get('person-1'))?.name === 'Lan A' &&
      (await client.db.employees.get('person-1'))?.name === 'Lan A'
    )

    expect(await client.db.employees.get('person-1')).toMatchObject({
      id: 'person-1',
      name: 'Lan A',
      role: 'Lead'
    })
    expect(await host.db.employees.get('legacy-person')).toBeNull()
    expect(await host.db.tasks.get('legacy-task')).toMatchObject({
      assigneeIds: ['person-1'],
      assigneeId: null
    })

    client.setDeviceName('Lan A Updated')
    await waitFor(async () => (await host.db.employees.get('person-1'))?.name === 'Lan A Updated')
    expect(await host.db.employees.list()).toHaveLength(1)
  })

  it('lets a client claim a legacy profile whose name does not match its device name', async () => {
    const host = new LanSyncManager(createDb(
      [{ id: 'old-task', assigneeIds: ['legacy-person'] }],
      [{ id: 'legacy-person', name: 'Nguyễn Văn A', role: 'Dev' }]
    ))
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    client.setClientIdentity('person-1')
    client.setDeviceName('DESKTOP-9KQ2')

    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(async () => (await client.db.employees.get('person-1'))?.name === 'DESKTOP-9KQ2')
    // Name differs, so the automatic migration leaves the task orphaned.
    expect((await host.db.tasks.get('old-task')).assigneeIds).toEqual(['legacy-person'])

    const result = await client.sendClientAction('profile:claim', {
      personId: 'person-1',
      legacyId: 'legacy-person'
    })
    await client.applyProfileClaim(result)

    expect((await host.db.tasks.get('old-task')).assigneeIds).toEqual(['person-1'])
    expect(await host.db.employees.get('legacy-person')).toBeNull()
    expect(await host.db.employees.get('person-1')).toMatchObject({ name: 'Nguyễn Văn A', role: 'Dev' })
    expect((await client.db.tasks.get('old-task')).assigneeIds).toEqual(['person-1'])
    expect(await client.db.employees.get('legacy-person')).toBeNull()
    expect(await client.db.employees.get('person-1')).toMatchObject({ name: 'Nguyễn Văn A' })

    await expect(
      client.sendClientAction('profile:claim', { personId: 'person-1', legacyId: 'legacy-person' })
    ).rejects.toThrow('đã được người khác nhận')
  })

  it('delivers every task when the host sends a burst of changes to a file-backed client', async () => {
    // Regression: with real file storage the client applied events concurrently,
    // each reading then rewriting tasks.json, so most of a burst was lost.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskboard-burst-'))
    try {
      const hostDb = createDb()
      const clientDb = {
        tasks: new JsonCollection(dir, 'tasks'),
        employees: new JsonCollection(dir, 'employees')
      }
      const host = new LanSyncManager(hostDb)
      const client = new LanSyncManager(clientDb)
      managers.push(host, client)
      const port = await findFreePort()
      client.setClientIdentity('person-1')

      await host.startHost(port)
      await client.startClient('127.0.0.1', port, false)
      await waitFor(async () => (await clientDb.employees.list()).length > 0)

      const ids = Array.from({ length: 10 }, (_, i) => `burst-${i}`)
      for (const id of ids) {
        const saved = await hostDb.tasks.insert({ id, title: id, assigneeIds: ['person-1'] })
        host.notifyHostLocalChange('tasks:add', saved)
      }
      await waitFor(async () => (await clientDb.tasks.list()).length === ids.length)
      expect((await clientDb.tasks.list()).map((task) => task.id).sort()).toEqual([...ids].sort())

      // an update burst for the same tasks must also land completely
      for (const id of ids) {
        host.notifyHostLocalChange('tasks:update', await hostDb.tasks.update(id, { title: `${id}-edited` }))
      }
      await waitFor(async () => (await clientDb.tasks.list()).every((task) => task.title.endsWith('-edited')))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('allows client task creation and completion but rejects edits and deletes', async () => {
    const host = new LanSyncManager(createDb())
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected)

    const created = await client.sendClientAction('tasks:add', { title: 'Created over LAN' })
    expect(created).toMatchObject({ title: 'Created over LAN' })
    await waitFor(async () => (await host.db.tasks.get(created.id))?.title === 'Created over LAN')

    const updated = await client.sendClientAction('tasks:update', { id: created.id, patch: { done: true } })
    expect(updated).toMatchObject({ id: created.id, done: true })
    expect(updated.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await waitFor(async () => (await host.db.tasks.get(created.id))?.done === true)
    const firstCompletedAt = (await host.db.tasks.get(created.id)).completedAt
    expect(firstCompletedAt).toBe(updated.completedAt)

    const repeatedCompletion = await client.sendClientAction('tasks:update', {
      id: created.id,
      patch: { done: true }
    })
    expect(repeatedCompletion.completedAt).toBe(firstCompletedAt)

    await expect(client.sendClientAction('tasks:update', {
      id: created.id,
      patch: { title: 'Client changed this' }
    })).rejects.toThrow('Máy khách chỉ được đánh dấu hoàn thành')
    await expect(client.sendClientAction('tasks:update', {
      id: created.id,
      patch: { done: false }
    })).rejects.toThrow('Máy khách chỉ được đánh dấu hoàn thành')
    await expect(client.sendClientAction('tasks:delete', { id: created.id })).rejects.toThrow(
      'Chỉ máy chủ mới có quyền xóa'
    )
    expect(await host.db.tasks.get(created.id)).toMatchObject({
      title: 'Created over LAN',
      done: true
    })
  })

  it('restores host shared tasks after a disconnected client removes its cached copy', async () => {
    const sharedTask = { id: 'shared-task', title: 'Keep this task', done: false }
    const host = new LanSyncManager(createDb([sharedTask]))
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected)
    await waitFor(async () => Boolean(await client.db.tasks.get(sharedTask.id)))

    client.stopClient()
    expect(client.mode).toBe('client')
    await client.db.tasks.remove(sharedTask.id)
    expect(await client.db.tasks.get(sharedTask.id)).toBeNull()
    expect(await host.db.tasks.get(sharedTask.id)).toEqual(sharedTask)

    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected)
    await waitFor(async () => (await client.db.tasks.get(sharedTask.id))?.title === sharedTask.title)
    expect(await host.db.tasks.get(sharedTask.id)).toEqual(sharedTask)
  })

  it('lets clients and the host exchange chat messages and keeps recent history', async () => {
    const host = new LanSyncManager(createDb())
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    await host.startHost(port)
    let receivedChatHistory = false
    client.on('chat-history', () => {
      receivedChatHistory = true
    })
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected && receivedChatHistory)

    const hostMessages = []
    host.on('chat-message', (message) => hostMessages.push(message))
    const hostMessage = host.sendHostChat('Please review the new task')
    await waitFor(() => client.getChatHistory().some((message) => message.id === hostMessage.id))
    expect(client.getChatHistory()).toContainEqual(expect.objectContaining({
      sender: host.deviceName,
      senderType: 'host',
      senderId: 'host',
      text: 'Please review the new task'
    }))

    await client.sendClientChat('I will take a look')
    await waitFor(() => hostMessages.length === 2)
    expect(hostMessages[1]).toMatchObject({
      sender: client.deviceName,
      senderType: 'client',
      senderId: client.clientInstanceId,
      text: 'I will take a look'
    })
    expect(client.getChatHistory().map((message) => message.text)).toEqual([
      'Please review the new task',
      'I will take a look'
    ])
    await expect(client.sendClientChat('   ')).rejects.toThrow('không được để trống')
  })

  it('routes direct messages only between the selected LAN participants', async () => {
    const host = new LanSyncManager(createDb())
    const firstClient = new LanSyncManager(createDb())
    const secondClient = new LanSyncManager(createDb())
    const thirdClient = new LanSyncManager(createDb())
    managers.push(host, firstClient, secondClient, thirdClient)
    const port = await findFreePort()
    firstClient.setDeviceName('Lan A')
    secondClient.setDeviceName('Lan B')
    thirdClient.setDeviceName('Lan C')
    await host.startHost(port)
    await Promise.all([
      firstClient.startClient('127.0.0.1', port, false),
      secondClient.startClient('127.0.0.1', port, false),
      thirdClient.startClient('127.0.0.1', port, false)
    ])
    await waitFor(() =>
      firstClient.clientConnected &&
      secondClient.clientConnected &&
      thirdClient.clientConnected &&
      firstClient.availableClients.length === 3
    )
    expect(host.getStatus().host.clients).toContainEqual(expect.objectContaining({
      id: secondClient.clientInstanceId,
      name: 'Lan B'
    }))

    const hostMessages = []
    const firstMessages = []
    const secondMessages = []
    const thirdMessages = []
    host.on('chat-message', (message) => hostMessages.push(message))
    firstClient.on('chat-message', (message) => firstMessages.push(message))
    secondClient.on('chat-message', (message) => secondMessages.push(message))
    thirdClient.on('chat-message', (message) => thirdMessages.push(message))

    await firstClient.sendClientChat('Private note to Lan B', secondClient.clientInstanceId)
    await waitFor(() => secondMessages.some((message) => message.text === 'Private note to Lan B'))
    expect(firstMessages).toContainEqual(expect.objectContaining({
      direct: true,
      sender: 'Lan A',
      recipientId: secondClient.clientInstanceId,
      text: 'Private note to Lan B'
    }))
    expect(secondMessages).toContainEqual(expect.objectContaining({
      direct: true,
      sender: 'Lan A',
      recipient: 'Lan B',
      text: 'Private note to Lan B'
    }))
    expect(thirdMessages).toEqual([])
    expect(hostMessages).toEqual([])
    expect(firstClient.getChatHistory()).toEqual([])
    expect(firstClient.getDirectChatHistory(secondClient.clientInstanceId)).toContainEqual(
      expect.objectContaining({ text: 'Private note to Lan B' })
    )
    expect(host.getDirectChatHistory(secondClient.clientInstanceId)).toEqual([])

    const hostMessage = host.sendHostChat('Please call me', firstClient.clientInstanceId)
    await waitFor(() => firstMessages.some((message) => message.id === hostMessage.id))
    expect(firstMessages).toContainEqual(expect.objectContaining({
      sender: host.deviceName,
      recipientId: firstClient.clientInstanceId,
      text: 'Please call me'
    }))
    expect(host.getDirectChatHistory(firstClient.clientInstanceId)).toContainEqual(
      expect.objectContaining({ text: 'Please call me' })
    )
    expect(secondMessages.some((message) => message.text === 'Please call me')).toBe(false)
  })

  it('uses editable LAN display names for hosts, clients, and chat', async () => {
    const host = new LanSyncManager(createDb())
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    host.setDeviceName('Máy chủ nhóm')
    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected && client.hostName === 'Máy chủ nhóm')

    client.setDeviceName('Minh - Kế toán')
    await waitFor(() => host.getStatus().host.clients[0]?.name === 'Minh - Kế toán')
    const message = await client.sendClientChat('Xin chào')
    expect(message).toBeUndefined()
    await waitFor(() => host.getChatHistory().some((item) => item.text === 'Xin chào'))
    expect(host.getChatHistory()).toContainEqual(expect.objectContaining({
      sender: 'Minh - Kế toán',
      text: 'Xin chào'
    }))

    host.setDeviceName('Máy chủ mới')
    await waitFor(() => client.hostName === 'Máy chủ mới')
    expect(host.getStatus().deviceName).toBe('Máy chủ mới')
    expect(() => client.setDeviceName('   ')).toThrow('không được để trống')
    expect(() => client.setDeviceName('A'.repeat(41))).toThrow('40 ký tự')
  })

  it('rejects personal tasks sent to the host and invalid actions', async () => {
    const host = new LanSyncManager(createDb())
    managers.push(host)
    await expect(host._executeAction('tasks:add', { title: 'Private', personal: true })).rejects.toThrow(
      'không được đồng bộ'
    )
    await expect(host._executeAction('invalid', {})).rejects.toThrow('không hợp lệ')
  })

  it('stops both sides cleanly and rejects pending requests', async () => {
    const host = new LanSyncManager(createDb())
    const client = new LanSyncManager(createDb())
    managers.push(host, client)
    const port = await findFreePort()
    await host.startHost(port)
    await client.startClient('127.0.0.1', port, false)
    await waitFor(() => client.clientConnected)

    await host.stopAll()
    await waitFor(() => !client.clientConnected)
    expect(host.mode).toBe('standalone')
    expect(client.mode).toBe('client')
    expect(host.wss).toBeNull()
    expect(client.clientWs).toBeNull()
  })
})
