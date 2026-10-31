<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Sidebar from './components/Sidebar.vue'
import TaskList from './components/TaskList.vue'
import StatsView from './components/StatsView.vue'
import TeamView from './components/TeamView.vue'
import LanView from './components/LanView.vue'
import ChatView from './components/ChatView.vue'
import HelpView from './components/HelpView.vue'

const view = ref('tasks')
const alarms = ref([])
const focusedAlarm = ref(null)
const chatUnreadCount = ref(0)
const latestChatMessage = ref(null)
const lanMode = ref('client')
const lanClientId = ref('')
let removeAlarmListener
let removeAlarmFocusListener
let removeChatListener
let removeLanStatusListener

function updateLanIdentity(status) {
  lanMode.value = status?.mode || 'standalone'
  lanClientId.value = status?.client?.clientId || ''
}

function markChatRead() {
  chatUnreadCount.value = 0
  latestChatMessage.value = null
}

watch(view, (nextView) => {
  if (nextView === 'chat') markChatRead()
})

async function loadAlarms() {
  try {
    alarms.value = (await window.api.alarms.list()).filter((alarm) => !alarm.acknowledgedAt)
  } catch (err) {
    console.error('Không tải được báo thức:', err)
  }
}

async function acknowledgeAlarm(taskId) {
  await window.api.alarms.acknowledge(taskId)
  await loadAlarms()
  if (focusedAlarm.value?.taskId === taskId) focusedAlarm.value = null
}

async function snoozeAlarm(taskId, minutes) {
  try {
    await window.api.alarms.snooze(taskId, minutes)
    await loadAlarms()
    if (focusedAlarm.value?.taskId === taskId) focusedAlarm.value = null
  } catch (err) {
    console.error('Không hoãn được báo thức:', err)
  }
}

function snoozedText(alarm) {
  if (!alarm.snoozedUntil || alarm.snoozedUntil <= Date.now()) return ''
  const time = new Date(alarm.snoozedUntil).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit'
  })
  return `Đã hoãn đến ${time}`
}

async function focusAlarm(taskId) {
  await loadAlarms()
  const alarm = alarms.value.find((item) => item.taskId === taskId)
  if (alarm) focusedAlarm.value = alarm
}

onMounted(async () => {
  removeAlarmFocusListener = window.api.alarms.onFocus(focusAlarm)
  removeAlarmListener = window.api.alarms.onChanged((next) => {
    alarms.value = next.filter((alarm) => !alarm.acknowledgedAt)
    if (focusedAlarm.value && !alarms.value.some((alarm) => alarm.id === focusedAlarm.value.id)) {
      focusedAlarm.value = null
    }
  })
  removeChatListener = window.api.lan.onChatMessage((message) => {
    if (!message?.id) return
    const isOwnMessage = (lanMode.value === 'host' && message.senderId === 'host') ||
      (lanMode.value === 'client' && message.senderId === lanClientId.value)
    if (isOwnMessage || view.value === 'chat') return
    chatUnreadCount.value += 1
    latestChatMessage.value = message
  })
  removeLanStatusListener = window.api.lan.onStatusChange(updateLanIdentity)
  try {
    updateLanIdentity(await window.api.lan.getStatus())
  } catch (err) {
    console.error('Không tải được trạng thái LAN:', err)
  }
  await loadAlarms()
  const pendingTaskId = await window.api.alarms.consumeFocus()
  if (pendingTaskId) await focusAlarm(pendingTaskId)
})

onUnmounted(() => {
  removeAlarmListener?.()
  removeAlarmFocusListener?.()
  removeChatListener?.()
  removeLanStatusListener?.()
})
</script>

<template>
  <div class="shell">
    <Sidebar v-model="view" :chat-unread-count="chatUnreadCount" />
    <main class="content">
      <section v-if="alarms.length" class="alarm-panel" aria-live="assertive">
        <strong>Đang có {{ alarms.length }} báo thức chưa xác nhận</strong>
        <div v-for="alarm in alarms" :key="alarm.id" class="alarm-row">
          <span>{{ alarm.title || 'Công việc cần chú ý' }} <em v-if="snoozedText(alarm)">· {{ snoozedText(alarm) }}</em></span>
          <button class="btn btn-primary" @click="acknowledgeAlarm(alarm.taskId)">Đã nhận</button>
        </div>
      </section>
      <TaskList
        v-if="view === 'tasks'"
        :client-mode="lanMode === 'client'"
        :new-chat-message="latestChatMessage"
        @open-chat="view = 'chat'"
      />
      <StatsView v-else-if="view === 'stats'" />
      <TeamView v-else-if="view === 'team'" />
      <LanView v-else-if="view === 'lan'" />
      <HelpView v-else-if="view === 'help'" />
      <ChatView
        v-show="view === 'chat'"
        :active="view === 'chat'"
        @open-lan-settings="view = 'lan'"
      />
    </main>
    <div v-if="focusedAlarm" class="alarm-overlay" role="dialog" aria-modal="true">
      <section class="alarm-dialog">
        <div class="alarm-dialog-icon">!</div>
        <h2>Đã đến giờ làm việc</h2>
        <p>Công việc này chưa được xác nhận:</p>
        <strong>{{ focusedAlarm.title || 'Công việc đến hạn' }}</strong>
        <div class="alarm-actions">
          <button class="btn btn-secondary" @click="snoozeAlarm(focusedAlarm.taskId, 15)">
            Hoãn 15 phút
          </button>
          <button class="btn btn-secondary" @click="snoozeAlarm(focusedAlarm.taskId, 60)">
            Hoãn 1 giờ
          </button>
          <button class="btn btn-primary" @click="acknowledgeAlarm(focusedAlarm.taskId)">
            Đã nhận thông báo
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg);
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 36px 60px;
}
.content > * {
  max-width: 760px;
  margin: 0 auto;
}
.content > .chat-view {
  max-width: none;
  margin: 0;
}
.alarm-panel {
  max-width: 760px;
  margin: 0 auto 16px;
  padding: 14px 16px;
  border: 1px solid #f0b44d;
  border-radius: var(--radius-md);
  background: #fff8e8;
  color: #7a4d00;
}
.alarm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.alarm-row em {
  font-size: 12px;
  font-style: normal;
  color: var(--text-dim);
}
.alarm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.alarm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}
.alarm-dialog {
  width: min(420px, 100%);
  padding: 28px;
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.3);
  text-align: center;
}
.alarm-dialog-icon {
  width: 42px;
  height: 42px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #f0b44d;
  color: white;
  font-size: 24px;
  font-weight: 800;
}
.alarm-dialog h2 {
  margin: 0 0 10px;
  color: var(--text);
}
.alarm-dialog p {
  margin: 0 0 6px;
  color: var(--text-dim);
}
.alarm-dialog strong {
  display: block;
  margin-bottom: 22px;
  color: var(--text);
  word-break: break-word;
}
</style>
