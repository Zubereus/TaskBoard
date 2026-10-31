const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    add: (task) => ipcRenderer.invoke('tasks:add', task),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id)
  },
  alarms: {
    list: () => ipcRenderer.invoke('alarms:list'),
    acknowledge: (taskId) => ipcRenderer.invoke('alarms:acknowledge', taskId),
    open: () => ipcRenderer.invoke('alarms:open'),
    consumeFocus: () => ipcRenderer.invoke('alarms:consumeFocus'),
    snooze: (taskId, minutes) => ipcRenderer.invoke('alarms:snooze', taskId, minutes),
    onChanged: (callback) => {
      const listener = (_e, data) => callback(data)
      ipcRenderer.on('alarms:changed', listener)
      return () => ipcRenderer.removeListener('alarms:changed', listener)
    },
    onFocus: (callback) => {
      const listener = (_e, taskId) => callback(taskId)
      ipcRenderer.on('alarms:focus', listener)
      return () => ipcRenderer.removeListener('alarms:focus', listener)
    }
  },
  employees: {
    list: () => ipcRenderer.invoke('employees:list'),
    add: (employee) => ipcRenderer.invoke('employees:add', employee),
    update: (id, patch) => ipcRenderer.invoke('employees:update', id, patch),
    delete: (id) => ipcRenderer.invoke('employees:delete', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch)
  },
  calendar: {
    status: () => ipcRenderer.invoke('calendar:status'),
    connect: () => ipcRenderer.invoke('calendar:connect'),
    disconnect: () => ipcRenderer.invoke('calendar:disconnect'),
    listCalendars: () => ipcRenderer.invoke('calendar:listCalendars'),
    sync: (taskId) => ipcRenderer.invoke('calendar:sync', taskId)
  },
  lan: {
    getStatus: () => ipcRenderer.invoke('lan:getStatus'),
    getChatHistory: () => ipcRenderer.invoke('lan:getChatHistory'),
    getDirectChatHistory: (participantId) => ipcRenderer.invoke('lan:getDirectChatHistory', participantId),
    sendChat: (text, recipientId) => ipcRenderer.invoke('lan:sendChat', text, recipientId),
    getLocalIps: () => ipcRenderer.invoke('lan:getLocalIps'),
    discoverHosts: () => ipcRenderer.invoke('lan:discoverHosts'),
    startHost: (port) => ipcRenderer.invoke('lan:startHost', port),
    stopHost: () => ipcRenderer.invoke('lan:stopHost'),
    startClient: (hostIp, port, autoConnect) => ipcRenderer.invoke('lan:startClient', hostIp, port, autoConnect),
    stopClient: () => ipcRenderer.invoke('lan:stopClient'),
    setStandalone: () => ipcRenderer.invoke('lan:setStandalone'),
    onStatusChange: (callback) => {
      const listener = (_e, data) => callback(data)
      ipcRenderer.on('lan:status-changed', listener)
      return () => ipcRenderer.removeListener('lan:status-changed', listener)
    },
    onDataSync: (callback) => {
      const listener = (_e, data) => callback(data)
      ipcRenderer.on('lan:data-sync', listener)
      return () => ipcRenderer.removeListener('lan:data-sync', listener)
    },
    onChatMessage: (callback) => {
      const listener = (_e, message) => callback(message)
      ipcRenderer.on('lan:chat-message', listener)
      return () => ipcRenderer.removeListener('lan:chat-message', listener)
    },
    onChatHistory: (callback) => {
      const listener = (_e, messages) => callback(messages)
      ipcRenderer.on('lan:chat-history', listener)
      return () => ipcRenderer.removeListener('lan:chat-history', listener)
    }
  },
  export: {
    tasksDocx: (options) => ipcRenderer.invoke('export:tasksDocx', options),
    openFile: (filePath) => ipcRenderer.invoke('shell:openPath', filePath)
  }
})
