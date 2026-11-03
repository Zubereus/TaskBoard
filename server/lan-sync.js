const WebSocket = require('ws')
const dgram = require('dgram')
const os = require('os')
const EventEmitter = require('events')
const { completionPatch } = require('./task-completion')
const { reconcilePersonProfile } = require('./person-profile')

const DEFAULT_PORT = 22236
const DISCOVERY_PORT = 22237
const MAX_CLIENT_CONNECT_ATTEMPTS = 3

/**
 * Returns a list of local IPv4 addresses on this machine.
 * Sorts them prioritizing standard physical LAN subnets (Wi-Fi/Ethernet).
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces()
  const results = []

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue
    const lowerName = name.toLowerCase()
    const isVirtual =
      lowerName.includes('virtual') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('wsl') ||
      lowerName.includes('vmware') ||
      lowerName.includes('host-only') ||
      lowerName.includes('radmin') ||
      lowerName.includes('tap') ||
      lowerName.includes('tun') ||
      lowerName.includes('loopback')

    for (const addr of addrs) {
      if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal) {
        let priority = 50
        if (isVirtual || addr.address.startsWith('192.168.56.')) {
          priority = 90
        } else if (addr.address.startsWith('192.168.')) {
          priority = 10
        } else if (addr.address.startsWith('10.')) {
          priority = 20
        } else if (addr.address.startsWith('172.')) {
          priority = 30
        }

        if (!isVirtual && (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan'))) {
          priority -= 5
        }

        results.push({
          address: addr.address,
          name,
          netmask: addr.netmask,
          isVirtual,
          priority
        })
      }
    }
  }

  results.sort((a, b) => a.priority - b.priority)
  return results
}

function getPrimaryLocalIp() {
  const ips = getLocalIpAddresses()
  return ips.length > 0 ? ips[0].address : '127.0.0.1'
}

function getIpPriority(ip) {
  if (ip.startsWith('192.168.') && !ip.startsWith('192.168.56.')) return 10
  if (ip.startsWith('10.')) return 20
  if (ip.startsWith('172.')) return 30
  if (ip === '127.0.0.1') return 40
  return 90
}

/**
 * Calculates broadcast addresses for all local physical adapters
 */
function getBroadcastAddresses() {
  const broadcasts = new Set(['255.255.255.255', '127.0.0.1'])
  const interfaces = os.networkInterfaces()

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal && addr.netmask) {
        try {
          const ipParts = addr.address.split('.').map(Number)
          const maskParts = addr.netmask.split('.').map(Number)
          const bcastParts = ipParts.map((part, i) => (part | (~maskParts[i] & 255)))
          broadcasts.add(bcastParts.join('.'))
        } catch {
          // ignore
        }
      }
    }
  }

  return Array.from(broadcasts)
}

class LanSyncManager extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
    this.mode = 'standalone' // 'standalone' | 'host' | 'client'
    this.hostPort = DEFAULT_PORT
    this.clientTarget = { host: '', port: DEFAULT_PORT }
    this.autoConnect = true
    this.clientInstanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    this.hostName = ''

    // Host state
    this.wss = null
    this.hostUdpSocket = null
    this.connectedClients = new Map() // ws -> { id, ip, name, connectedAt }

    // Client state
    this.clientWs = null
    this.clientConnected = false
    this.reconnectTimer = null
    this.clientConnectAttempts = 0
    this.pendingRequests = new Map()
    this.reqIdCounter = 1
    this.chatMessages = []
    this.directMessages = []
    this.availableClients = []

    // Discovery state
    this.discoveredHosts = new Map() // ip:port -> { hostName, ip, port, lastSeen }
    this.isDiscovering = false

    this.deviceName = os.hostname()
  }

  getStatus() {
    const localIps = getLocalIpAddresses()
    const activeClients = Array.from(this.connectedClients.values()).map((c) => ({
      id: c.clientId || c.id,
      ip: c.ip,
      name: c.name,
      connectedAt: c.connectedAt
    }))

    const discovered = Array.from(this.discoveredHosts.values())

    return {
      mode: this.mode,
      deviceName: this.deviceName,
      hostName: this.hostName,
      hostPersonId: this.hostPersonId || '',
      personId: this.clientInstanceId,
      localIps,
      primaryIp: getPrimaryLocalIp(),
      host: {
        isRunning: !!this.wss,
        port: this.hostPort,
        clientCount: this.connectedClients.size,
        clients: activeClients
      },
      client: {
        connected: this.clientConnected,
        clientId: this.clientInstanceId,
        targetHost: this.clientTarget.host,
        targetPort: this.clientTarget.port,
        autoConnect: this.autoConnect,
        isDiscovering: this.isDiscovering,
        clients: this.availableClients
      },
      discoveredHosts: discovered
    }
  }

  emitStatus() {
    this.emit('status-changed', this.getStatus())
  }

  setDeviceName(name) {
    const nextName = String(name || '').trim()
    if (!nextName) throw new Error('Tên hiển thị không được để trống.')
    if (nextName.length > 40) throw new Error('Tên hiển thị không được vượt quá 40 ký tự.')

    this.deviceName = nextName
    this.emitStatus()

    if (this.mode === 'client' && this.clientConnected && this.clientWs) {
      this.clientWs.send(JSON.stringify({
        type: 'hello',
        clientName: this.deviceName,
        clientId: this.clientInstanceId
      }))
    } else if (this.mode === 'host' && this.wss) {
      const payload = JSON.stringify({ type: 'device-name', name: this.deviceName })
      for (const client of this.connectedClients.keys()) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload)
          } catch (err) {
            console.warn('Could not update LAN host name:', err.message)
          }
        }
      }
    }

    return this.deviceName
  }

  setClientIdentity(id) {
    const nextId = String(id || '').trim()
    if (!nextId) throw new Error('Mã định danh cá nhân không được để trống.')
    this.clientInstanceId = nextId

    if (this.mode === 'client' && this.clientConnected && this.clientWs) {
      this.clientWs.send(JSON.stringify({
        type: 'hello',
        clientName: this.deviceName,
        clientId: this.clientInstanceId
      }))
    }

    return this.clientInstanceId
  }

  // -------------------------------------------------------------
  // HOST MODE: Listens on TCP 22236 and responds to UDP TODOAPP_DISCOVER on 22237
  // -------------------------------------------------------------
  async startHost(port = DEFAULT_PORT) {
    await this.stopAll()
    this.mode = 'host'
    this.hostPort = Number(port) || DEFAULT_PORT

    return new Promise((resolve, reject) => {
      try {
        // 1. Start WebSocket TCP server
        this.wss = new WebSocket.Server({ port: this.hostPort }, () => {
          // 2. Start UDP Discovery Responder
          this._startHostDiscoveryResponder()
          this.emitStatus()
          resolve(this.getStatus())
        })

        this.wss.on('connection', (ws, req) => {
          this._handleClientConnection(ws, req)
        })

        this.wss.on('error', (err) => {
          this.emit('error', `Lỗi máy chủ Host: ${err.message}`)
          this.stopHost()
          reject(err)
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  _startHostDiscoveryResponder() {
    this._stopHostDiscoveryResponder()
    try {
      this.hostUdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      this.hostUdpSocket.on('message', (msg, rinfo) => {
        const text = msg.toString().trim()
        if (text.startsWith('TODOAPP_DISCOVER')) {
          // Reply directly to the client's IP and port: TODOAPP_HOST:<port>:<deviceName>
          const replyText = `TODOAPP_HOST:${this.hostPort}:${this.deviceName}`
          const replyBuf = Buffer.from(replyText)
          this.hostUdpSocket.send(replyBuf, 0, replyBuf.length, rinfo.port, rinfo.address, (err) => {
            if (err) console.warn('Host discovery reply error:', err.message)
          })
        }
      })

      this.hostUdpSocket.on('error', (err) => {
        console.warn('Host discovery socket error:', err.message)
      })

      this.hostUdpSocket.bind(DISCOVERY_PORT)
    } catch (err) {
      console.warn('Could not bind discovery socket:', err.message)
    }
  }

  _stopHostDiscoveryResponder() {
    if (this.hostUdpSocket) {
      try {
        this.hostUdpSocket.close()
      } catch {
        // ignore
      }
      this.hostUdpSocket = null
    }
  }

  stopHost() {
    this._stopHostDiscoveryResponder()

    if (this.wss) {
      for (const client of this.connectedClients.keys()) {
        try {
          client.close(1000, 'Máy chủ đã dừng')
        } catch {
          // ignore
        }
      }
      this.connectedClients.clear()
      try {
        this.wss.close()
      } catch {
        // ignore
      }
      this.wss = null
    }

    if (this.mode === 'host') {
      this.mode = 'standalone'
    }
    this.emitStatus()
  }

  _handleClientConnection(ws, req) {
    const rawIp = req.socket.remoteAddress || ''
    const clientIp = rawIp.replace(/^::ffff:/, '')
    const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    const clientMeta = {
      id: clientId,
      ip: clientIp,
      name: clientIp === '127.0.0.1' ? `${this.deviceName} (Local)` : `Thiết bị ${clientIp}`,
      connectedAt: new Date().toLocaleTimeString('vi-VN')
    }
    this.connectedClients.set(ws, clientMeta)
    this.emitStatus()

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString())
        await this._handleHostIncomingMessage(ws, clientMeta, msg)
      } catch {
        // ignore
      }
    })

    ws.on('close', () => {
      this.connectedClients.delete(ws)
      this._broadcastParticipants()
      this.emitStatus()
    })

    ws.on('error', () => {
      this.connectedClients.delete(ws)
      this._broadcastParticipants()
      this.emitStatus()
    })
  }

  _getConnectedClientList() {
    return Array.from(this.connectedClients.values())
      .filter((client) => client.clientId)
      .map(({ clientId, name }) => ({ id: clientId, name }))
  }

  _broadcastParticipants() {
    const payload = JSON.stringify({ type: 'participants', clients: this._getConnectedClientList() })
    for (const client of this.connectedClients.keys()) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (err) {
          console.warn('Could not update LAN chat participants:', err.message)
        }
      }
    }
  }

  _recordDirectMessage(message) {
    this.directMessages.push(message)
    if (this.directMessages.length > 500) this.directMessages.shift()
  }

  _routeClientDirectMessage(senderWs, senderMeta, recipientId, text) {
    const recipientWs = recipientId === 'host'
      ? null
      : Array.from(this.connectedClients.entries()).find(([, client]) => client.clientId === recipientId)?.[0]
    if (recipientId !== 'host' && !recipientWs) {
      throw new Error('Người nhận hiện không kết nối với máy chủ.')
    }

    const recipientMeta = recipientId === 'host'
      ? { clientId: 'host', name: this.deviceName }
      : this.connectedClients.get(recipientWs)
    const message = this._createChatMessage(text, senderMeta.name, 'client', senderMeta.clientId)
    Object.assign(message, {
      direct: true,
      recipientId,
      recipient: recipientMeta.name
    })
    if (recipientId === 'host') this._recordDirectMessage(message)

    const payload = JSON.stringify({ type: 'chat-message', message })
    for (const client of new Set([senderWs, recipientWs])) {
      if (client && client.readyState === WebSocket.OPEN) client.send(payload)
    }
    if (recipientId === 'host') this.emit('chat-message', message)
    return message
  }

  async _handleHostIncomingMessage(ws, clientMeta, msg) {
    if (msg.type === 'hello') {
      clientMeta.name = msg.clientName || clientMeta.name
      clientMeta.clientId = msg.clientId || clientMeta.id
      const { employee, migratedEmployeeIds, updatedTasks } = await reconcilePersonProfile(
        this.db.employees,
        this.db.tasks,
        { personId: clientMeta.clientId, name: clientMeta.name }
      )
      for (const task of updatedTasks) {
        this._broadcastEvent('tasks:update', task, ws)
      }
      for (const id of migratedEmployeeIds) {
        this._broadcastEvent('employees:delete', { id }, ws)
      }
      this._broadcastEvent('employees:update', employee, ws)
      this.emitStatus()

      const tasks = (await this.db.tasks.list()).filter((task) => !task.personal)
      const employees = await this.db.employees.list()
      ws.send(
        JSON.stringify({
          type: 'welcome',
          hostName: this.deviceName,
          hostPersonId: this.clientInstanceId,
          tasks,
          employees,
          chatMessages: this.chatMessages,
          directMessages: this.directMessages.filter(
            (message) => message.senderId === clientMeta.clientId || message.recipientId === clientMeta.clientId
          ),
          clients: this._getConnectedClientList()
        })
      )
      this._broadcastParticipants()
      return
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
      return
    }

    if (msg.type === 'chat') {
      const { requestId } = msg
      try {
        if (msg.recipientId) {
          this._routeClientDirectMessage(ws, clientMeta, msg.recipientId, msg.text)
          ws.send(JSON.stringify({ type: 'chat-response', requestId, success: true }))
          return
        }
        const chatMessage = this._createChatMessage(msg.text, clientMeta.name, 'client', clientMeta.clientId)
        this._recordChatMessage(chatMessage)
        this._broadcastChatMessage(chatMessage)
        ws.send(JSON.stringify({ type: 'chat-response', requestId, success: true }))
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'chat-response',
          requestId,
          success: false,
          error: err.message || 'Không thể gửi tin nhắn.'
        }))
      }
      return
    }

    if (msg.type === 'action') {
      const { action, payload, requestId } = msg
      try {
        const result = await this._executeAction(action, payload)
        ws.send(JSON.stringify({ type: 'response', requestId, success: true, result }))
        this._broadcastEvent(action, result, ws)
        this.emit('data-synced', { action, result })
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: 'response',
            requestId,
            success: false,
            error: err.message || 'Lỗi xử lý yêu cầu'
          })
        )
      }
    }
  }

  async _executeAction(action, payload) {
    switch (action) {
      case 'tasks:list':
        return await this.db.tasks.list()
      case 'tasks:add':
        if (payload.personal) throw new Error('Công việc cá nhân không được đồng bộ qua mạng LAN.')
        return await this.db.tasks.insert(payload)
      case 'tasks:update':
      {
        const existing = await this.db.tasks.get(payload.id)
        if (existing?.personal) {
          throw new Error('Công việc cá nhân chỉ được chỉnh sửa trên máy đã tạo.')
        }
        if (
          !payload.patch ||
          Object.keys(payload.patch).length !== 1 ||
          payload.patch.done !== true
        ) {
          throw new Error('Máy khách chỉ được đánh dấu hoàn thành công việc chung.')
        }
        return await this.db.tasks.update(
          payload.id,
          completionPatch(existing, payload.patch)
        )
      }
      case 'tasks:delete':
        throw new Error('Chỉ máy chủ mới có quyền xóa công việc chung.')

      case 'employees:list':
        return await this.db.employees.list()
      case 'employees:add':
        {
          const normalizedName = String(payload?.name || '').trim().toLocaleLowerCase()
          const normalizedRole = String(payload?.role || '').trim().toLocaleLowerCase()
          const existing = (await this.db.employees.list()).find(
            (employee) =>
              String(employee.name || '').trim().toLocaleLowerCase() === normalizedName &&
              String(employee.role || '').trim().toLocaleLowerCase() === normalizedRole
          )
          if (existing) return existing
        }
        return await this.db.employees.insert(payload)
      case 'employees:update':
        return await this.db.employees.update(payload.id, payload.patch)
      case 'employees:delete': {
        const allTasks = await this.db.tasks.list()
        const affected = allTasks.filter((t) =>
          (t.assigneeIds || (t.assigneeId ? [t.assigneeId] : [])).includes(payload.id)
        )
        await Promise.all(
          affected.map((t) => {
            const current = t.assigneeIds || (t.assigneeId ? [t.assigneeId] : [])
            return this.db.tasks.update(t.id, {
              assigneeIds: current.filter((aid) => aid !== payload.id),
              assigneeId: null
            })
          })
        )
        return await this.db.employees.remove(payload.id)
      }
      default:
        throw new Error(`Hành động không hợp lệ: ${action}`)
    }
  }

  _broadcastEvent(action, data, excludeWs = null) {
    const payload = JSON.stringify({ type: 'event', action, data })
    for (const client of this.connectedClients.keys()) {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch {
          // ignore
        }
      }
    }
  }

  _createChatMessage(text, sender, senderType, senderId) {
    const message = String(text || '').trim()
    if (!message) throw new Error('Tin nhắn không được để trống.')
    if (message.length > 1000) throw new Error('Tin nhắn không được vượt quá 1000 ký tự.')
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sender,
      senderType,
      senderId,
      text: message,
      sentAt: new Date().toISOString()
    }
  }

  _recordChatMessage(message) {
    this.chatMessages.push(message)
    if (this.chatMessages.length > 100) this.chatMessages.shift()
  }

  _broadcastChatMessage(message) {
    const payload = JSON.stringify({ type: 'chat-message', message })
    for (const client of this.connectedClients.keys()) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (err) {
          console.warn('Could not send LAN chat message:', err.message)
        }
      }
    }
    this.emit('chat-message', message)
  }

  sendHostChat(text, recipientId = null) {
    if (this.mode !== 'host' || !this.wss) {
      throw new Error('Máy chủ LAN chưa được bật.')
    }
    if (recipientId) {
      const target = Array.from(this.connectedClients.entries())
        .find(([, client]) => client.clientId === recipientId)
      if (!target) throw new Error('Người nhận hiện không kết nối với máy chủ.')
      const [ws, client] = target
      const message = this._createChatMessage(text, this.deviceName, 'host', 'host')
      Object.assign(message, { direct: true, recipientId: client.clientId, recipient: client.name })
      this._recordDirectMessage(message)
      ws.send(JSON.stringify({ type: 'chat-message', message }))
      this.emit('chat-message', message)
      return message
    }
    const message = this._createChatMessage(text, this.deviceName, 'host', 'host')
    this._recordChatMessage(message)
    this._broadcastChatMessage(message)
    return message
  }

  getChatHistory() {
    return this.chatMessages.slice()
  }

  getDirectChatHistory(participantId) {
    if (this.mode === 'host') {
      return this.directMessages.filter(
        (message) =>
          (message.senderId === 'host' && message.recipientId === participantId) ||
          (message.senderId === participantId && message.recipientId === 'host')
      )
    }
    return this.directMessages.filter(
      (message) => message.senderId === participantId || message.recipientId === participantId
    )
  }

  notifyHostLocalChange(action, data) {
    if (this.mode === 'host' && this.wss) {
      this._broadcastEvent(action, data)
    }
  }

  // -------------------------------------------------------------
  // CLIENT MODE: Connects to Host, with UDP discovery probe
  // -------------------------------------------------------------
  async startClient(hostIp, port = DEFAULT_PORT, autoConnect = true) {
    await this.stopAll()
    this.mode = 'client'
    this.clientConnectAttempts = 0
    this.clientTarget = { host: hostIp ? hostIp.trim() : '', port: Number(port) || DEFAULT_PORT }
    this.autoConnect = autoConnect

    if (this.clientTarget.host) {
      this._connectClient()
    } else {
      // No saved host IP yet: perform discovery probe
      this.discoverHosts()
    }
    this.emitStatus()
  }

  /**
   * Client-side discovery probe:
   * Sends UDP broadcast TODOAPP_DISCOVER to port 22237.
   * Listens for replies directly from Host: TODOAPP_HOST:<port>:<name>
   */
  async discoverHosts(timeoutMs = 2500) {
    if (this.isDiscovering) return Array.from(this.discoveredHosts.values())

    this.isDiscovering = true
    this.emitStatus()

    return new Promise((resolve) => {
      let clientUdp = null
      let timeoutHandle = null

      const finish = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        this.isDiscovering = false
        if (clientUdp) {
          try {
            clientUdp.close()
          } catch {
            // ignore
          }
          clientUdp = null
        }
        this.emitStatus()
        resolve(Array.from(this.discoveredHosts.values()))
      }

      try {
        clientUdp = dgram.createSocket('udp4')

        clientUdp.on('message', (msg, rinfo) => {
          const text = msg.toString().trim()
          if (text.startsWith('TODOAPP_HOST:')) {
            const parts = text.split(':')
            const port = Number(parts[1]) || DEFAULT_PORT
            const hostName = parts[2] || rinfo.address
            const senderIp = rinfo.address
            const newPri = getIpPriority(senderIp)

            // Deduplicate multiple interfaces from same machine by hostname
            let existingEntry = null
            for (const [k, v] of this.discoveredHosts.entries()) {
              if (v.hostName === hostName) {
                existingEntry = { key: k, value: v }
                break
              }
            }

            if (!existingEntry) {
              const key = `${senderIp}:${port}`
              this.discoveredHosts.set(key, {
                hostName,
                ip: senderIp,
                port,
                lastSeen: Date.now()
              })
              this.emit('host-discovered', this.discoveredHosts.get(key))
              this.emitStatus()
            } else {
              const oldPri = getIpPriority(existingEntry.value.ip)
              if (newPri < oldPri) {
                this.discoveredHosts.delete(existingEntry.key)
                const key = `${senderIp}:${port}`
                this.discoveredHosts.set(key, {
                  hostName,
                  ip: senderIp,
                  port,
                  lastSeen: Date.now()
                })
                this.emit('host-discovered', this.discoveredHosts.get(key))
                this.emitStatus()
              }
            }
          }
        })

        clientUdp.on('error', () => {
          finish()
        })

        clientUdp.bind(0, () => {
          try {
            clientUdp.setBroadcast(true)
            const probe = Buffer.from('TODOAPP_DISCOVER')
            const targets = getBroadcastAddresses()

            for (const addr of targets) {
              clientUdp.send(probe, 0, probe.length, DISCOVERY_PORT, addr, () => {})
            }
          } catch {
            // ignore
          }
        })

        timeoutHandle = setTimeout(finish, timeoutMs)
      } catch {
        finish()
      }
    })
  }

  _connectClient() {
    this._clearReconnectTimer()
    if (!this.clientTarget.host) return
    if (this.clientConnectAttempts >= MAX_CLIENT_CONNECT_ATTEMPTS) {
      this.autoConnect = false
      console.warn('Không thể kết nối máy chủ LAN sau 3 lần thử.')
      this.emit('client-connect-failed')
      this.emitStatus()
      return
    }

    const url = `ws://${this.clientTarget.host}:${this.clientTarget.port}`
    this.clientConnectAttempts += 1

    try {
      this.clientWs = new WebSocket(url, { handshakeTimeout: 4000 })
      const ws = this.clientWs

      ws.on('open', () => {
        if (ws !== this.clientWs) {
          ws.close()
          return
        }
        this.clientConnected = true
        this.clientConnectAttempts = 0
        this._clearReconnectTimer()
        this.emitStatus()

        ws.send(
          JSON.stringify({
            type: 'hello',
            clientName: this.deviceName,
            clientId: this.clientInstanceId
          })
        )
      })

      ws.on('message', async (data) => {
        if (ws !== this.clientWs) return
        try {
          const msg = JSON.parse(data.toString())
          await this._handleClientIncomingMessage(msg)
        } catch {
          // ignore
        }
      })

      ws.on('close', () => {
        this._handleClientDisconnect(ws)
      })

      ws.on('error', () => {
        this._handleClientDisconnect(ws)
      })
    } catch {
      this._handleClientDisconnect()
    }
  }

  _handleClientDisconnect(disconnectedWs = this.clientWs) {
    if (disconnectedWs && disconnectedWs !== this.clientWs) return
    this.clientWs = null

    if (disconnectedWs && disconnectedWs.readyState === WebSocket.OPEN) {
      try {
        disconnectedWs.close()
      } catch {
        // ignore
      }
    }

    if (this.clientConnected) {
      this.clientConnected = false
      this.emitStatus()
      this.emit('client-disconnected')
    }

    if (this.mode === 'client' && this.autoConnect && this.clientConnectAttempts < MAX_CLIENT_CONNECT_ATTEMPTS) {
      this._scheduleReconnect()
    } else if (this.mode === 'client' && !this.clientConnected) {
      this.autoConnect = false
      console.warn(`Không thể kết nối máy chủ LAN sau ${MAX_CLIENT_CONNECT_ATTEMPTS} lần thử.`)
      this.emit('client-connect-failed')
      this.emitStatus()
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      if (this.mode === 'client' && !this.clientConnected) {
        this._connectClient()
      }
    }, 4000)
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  async _handleClientIncomingMessage(msg) {
    if (msg.type === 'welcome') {
      this.hostName = msg.hostName || this.hostName
      this.hostPersonId = msg.hostPersonId || this.hostPersonId
      this.availableClients = Array.isArray(msg.clients) ? msg.clients : []
      this.emitStatus()
      if (Array.isArray(msg.tasks)) {
        const localTasks = (await this.db.tasks.list()).filter((task) => task.personal)
        await this.db.tasks._write([...msg.tasks.filter((task) => !task.personal), ...localTasks])
      }
      if (Array.isArray(msg.employees)) {
        await this.db.employees._write(msg.employees)
      }
      if (Array.isArray(msg.chatMessages)) {
        this.chatMessages = msg.chatMessages.slice(-100)
        this.emit('chat-history', this.getChatHistory())
      }
      if (Array.isArray(msg.directMessages)) {
        const knownIds = new Set(this.directMessages.map((message) => message.id))
        this.directMessages.push(...msg.directMessages.filter((message) => !knownIds.has(message.id)))
        this.directMessages = this.directMessages.slice(-500)
        this.emit('chat-history', this.directMessages.slice())
      }
      this.emit('data-synced', { type: 'full-sync', tasks: msg.tasks, employees: msg.employees })
      return
    }

    if (msg.type === 'participants') {
      this.availableClients = Array.isArray(msg.clients) ? msg.clients : []
      this.emitStatus()
      return
    }

    if (msg.type === 'device-name') {
      this.hostName = msg.name || this.hostName
      this.emitStatus()
      return
    }

    if (msg.type === 'chat-message') {
      if (msg.message?.direct) {
        if (msg.message.id && !this.directMessages.some((message) => message.id === msg.message.id)) {
          this._recordDirectMessage(msg.message)
        }
      } else if (msg.message?.id && !this.chatMessages.some((message) => message.id === msg.message.id)) {
        this._recordChatMessage(msg.message)
      }
      this.emit('chat-message', msg.message)
      return
    }

    if (msg.type === 'chat-response') {
      const pending = this.pendingRequests.get(msg.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.requestId)
        if (msg.success) pending.resolve()
        else pending.reject(new Error(msg.error || 'Không thể gửi tin nhắn.'))
      }
      return
    }

    if (msg.type === 'response') {
      const pending = this.pendingRequests.get(msg.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.requestId)
        if (msg.success) pending.resolve(msg.result)
        else pending.reject(new Error(msg.error || 'Yêu cầu thất bại'))
      }
      return
    }

    if (msg.type === 'event') {
      await this._applyRemoteEvent(msg.action, msg.data)
      this.emit('data-synced', { action: msg.action, result: msg.data })
    }
  }

  async _applyRemoteEvent(action, data) {
    try {
      switch (action) {
        case 'tasks:add':
        case 'tasks:update': {
          if (!data || !data.id) return
          if (data.personal) return
          const all = await this.db.tasks.list()
          const idx = all.findIndex((t) => t.id === data.id)
          if (idx >= 0) all[idx] = data
          else all.push(data)
          await this.db.tasks._write(all)
          break
        }
        case 'tasks:delete': {
          const all = await this.db.tasks.list()
          if (all.some((task) => task.id === (data.id || data) && task.personal)) return
          await this.db.tasks._write(all.filter((t) => t.id !== data.id && t.id !== data))
          break
        }
        case 'employees:add':
        case 'employees:update': {
          if (!data || !data.id) return
          const all = await this.db.employees.list()
          const idx = all.findIndex((e) => e.id === data.id)
          if (idx >= 0) all[idx] = data
          else all.push(data)
          await this.db.employees._write(all)
          break
        }
        case 'employees:delete': {
          const all = await this.db.employees.list()
          await this.db.employees._write(all.filter((e) => e.id !== data.id && e.id !== data))
          break
        }
      }
    } catch {
      // ignore
    }
  }

  async sendClientAction(action, payload) {
    if (!this.clientConnected || !this.clientWs) {
      throw new Error('Chưa kết nối đến máy chủ LAN. Vui lòng kiểm tra lại kết nối.')
    }

    const requestId = this.reqIdCounter++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Yêu cầu tới máy chủ quá thời gian chờ (Timeout).'))
      }, 7000)

      this.pendingRequests.set(requestId, { resolve, reject, timer })

      try {
        this.clientWs.send(
          JSON.stringify({
            type: 'action',
            action,
            payload,
            requestId
          })
        )
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(err)
      }
    })
  }

  async sendClientChat(text, recipientId = null) {
    if (!this.clientConnected || !this.clientWs) {
      throw new Error('Chưa kết nối đến máy chủ LAN. Vui lòng kiểm tra lại kết nối.')
    }
    const requestId = this.reqIdCounter++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Tin nhắn không được gửi: máy chủ không phản hồi.'))
      }, 7000)
      this.pendingRequests.set(requestId, { resolve, reject, timer })
      try {
        this.clientWs.send(JSON.stringify({ type: 'chat', requestId, text, recipientId }))
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(err)
      }
    })
  }

  stopClient() {
    this._clearReconnectTimer()
    if (this.clientWs) {
      try {
        this.clientWs.close()
      } catch {
        // ignore
      }
      this.clientWs = null
    }
    this.clientConnected = false

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Đã ngắt kết nối máy chủ'))
    }
    this.pendingRequests.clear()

    if (this.mode === 'client') this.autoConnect = false
    this.emitStatus()
  }

  async stopAll() {
    this.stopHost()
    this.stopClient()
    this.mode = 'standalone'
    this.emitStatus()
  }
}

module.exports = {
  LanSyncManager,
  getLocalIpAddresses,
  getPrimaryLocalIp,
  DEFAULT_PORT,
  DISCOVERY_PORT
}
