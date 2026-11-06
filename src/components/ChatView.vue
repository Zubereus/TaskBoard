<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  active: { type: Boolean, default: false }
})
const emit = defineEmits(['open-lan-settings'])

const lanStatus = ref({
  mode: 'standalone',
  hostName: '',
  host: { isRunning: false, clients: [] },
  client: { connected: false, clientId: '', clients: [] }
})
const chatMessages = ref([])
const activeChatId = ref('group')
const unreadChats = ref({})
const chatDraft = ref('')
const chatSending = ref(false)
const errorMessage = ref('')
let removeStatusListener
let removeChatListener
let removeHistoryListener

function mergeChatMessages(messages) {
  const knownIds = new Set(chatMessages.value.map((message) => message.id))
  chatMessages.value = [
    ...chatMessages.value,
    ...messages.filter((message) => message?.id && !knownIds.has(message.id))
  ].slice(-600)
}

const isConnected = computed(() => (
  (lanStatus.value.mode === 'host' && lanStatus.value.host.isRunning) ||
  (lanStatus.value.mode === 'client' && lanStatus.value.client.connected)
))

const chatParticipants = computed(() => {
  if (lanStatus.value.mode === 'host') {
    return lanStatus.value.host.clients.map((client) => ({ id: client.id, name: client.name }))
  }
  if (lanStatus.value.mode === 'client') {
    return [
      { id: 'host', name: lanStatus.value.hostName || 'Máy chủ' },
      ...lanStatus.value.client.clients
        .filter((client) => client.id !== lanStatus.value.client.clientId)
        .map((client) => ({ id: client.id, name: client.name }))
    ]
  }
  return []
})

const activeChatName = computed(() => {
  if (activeChatId.value === 'group') return 'Trò chuyện nhóm'
  return chatParticipants.value.find((participant) => participant.id === activeChatId.value)?.name ||
    (activeChatId.value === 'host' ? lanStatus.value.hostName || 'Máy chủ' : 'Trò chuyện trực tiếp')
})

const visibleChatMessages = computed(() => {
  if (activeChatId.value === 'group') {
    return chatMessages.value.filter((message) => !message.direct)
  }
  return chatMessages.value.filter((message) =>
    message.direct &&
    (message.senderId === activeChatId.value || message.recipientId === activeChatId.value)
  )
})

function isOwnMessage(message) {
  return (lanStatus.value.mode === 'host' && message.senderId === 'host') ||
    (lanStatus.value.mode === 'client' && message.senderId === lanStatus.value.client.clientId)
}

function conversationIdFor(message) {
  if (!message.direct) return 'group'
  const ownId = lanStatus.value.mode === 'host' ? 'host' : lanStatus.value.client.clientId
  return message.senderId === ownId ? message.recipientId : message.senderId
}

function receiveChatMessage(message) {
  mergeChatMessages([message])
  if (!message?.id || isOwnMessage(message)) return
  const conversationId = conversationIdFor(message)
  if (!props.active || activeChatId.value !== conversationId) {
    unreadChats.value[conversationId] = (unreadChats.value[conversationId] || 0) + 1
  }
}

async function selectChat(conversationId) {
  activeChatId.value = conversationId
  unreadChats.value[conversationId] = 0
  if (conversationId === 'group') return
  try {
    const history = await window.api.lan.getDirectChatHistory(conversationId)
    if (Array.isArray(history)) mergeChatMessages(history)
  } catch (err) {
    errorMessage.value = 'Không thể tải cuộc trò chuyện: ' + (err.message || err)
  }
}

function formatChatTime(timestamp) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

async function sendChatMessage() {
  const text = chatDraft.value.trim()
  if (!text || chatSending.value || !isConnected.value) return
  chatSending.value = true
  errorMessage.value = ''
  try {
    await window.api.lan.sendChat(text, activeChatId.value === 'group' ? null : activeChatId.value)
    chatDraft.value = ''
  } catch (err) {
    errorMessage.value = 'Không thể gửi tin nhắn: ' + (err.message || err)
  } finally {
    chatSending.value = false
  }
}

watch(() => props.active, (active) => {
  if (active) unreadChats.value[activeChatId.value] = 0
})

onMounted(async () => {
  removeStatusListener = window.api.lan.onStatusChange((status) => {
    lanStatus.value = status
  })
  removeChatListener = window.api.lan.onChatMessage(receiveChatMessage)
  removeHistoryListener = window.api.lan.onChatHistory((messages) => {
    if (Array.isArray(messages)) mergeChatMessages(messages)
  })

  try {
    lanStatus.value = await window.api.lan.getStatus()
    const history = await window.api.lan.getChatHistory()
    if (Array.isArray(history)) mergeChatMessages(history)
    if (activeChatId.value !== 'group') {
      await selectChat(activeChatId.value)
    }
  } catch (err) {
    errorMessage.value = 'Không thể tải trò chuyện: ' + (err.message || err)
  }
})

onUnmounted(() => {
  removeStatusListener?.()
  removeChatListener?.()
  removeHistoryListener?.()
})
</script>

<template>
  <div class="chat-view">
    <header class="chat-header">
      <div>
        <h1>Trò chuyện</h1>
      </div>
      <span class="connection-status" :class="{ connected: isConnected }">
        <span class="status-dot"></span>
        {{ isConnected ? 'Trực tuyến' : 'Chưa kết nối' }}
      </span>
    </header>

    <div v-if="errorMessage" class="chat-error" role="alert">{{ errorMessage }}</div>
    <div v-if="!isConnected" class="chat-connect-hint">
      <span>Kết nối với máy chủ trong mục <strong>Đồng bộ LAN</strong> để bắt đầu trò chuyện.</span>
      <button class="btn btn-secondary" @click="emit('open-lan-settings')">Mở Đồng bộ LAN</button>
    </div>

    <section class="chat-card" aria-label="Trò chuyện LAN">
      <nav class="chat-threads" aria-label="Danh sách cuộc trò chuyện">
        <button
          class="chat-thread-button"
          :class="{ active: activeChatId === 'group' }"
          :aria-pressed="activeChatId === 'group'"
          @click="selectChat('group')"
        >
          <span class="chat-thread-avatar">#</span>
          <span class="chat-thread-copy">
            <strong>Nhóm</strong>
            <small>Tất cả thiết bị</small>
          </span>
          <span v-if="unreadChats.group" class="chat-unread">{{ unreadChats.group }}</span>
        </button>
        <div class="chat-thread-label">TIN NHẮN RIÊNG</div>
        <button
          v-for="participant in chatParticipants"
          :key="participant.id"
          class="chat-thread-button"
          :class="{ active: activeChatId === participant.id }"
          :aria-pressed="activeChatId === participant.id"
          @click="selectChat(participant.id)"
        >
          <span class="chat-thread-avatar">{{ participant.name.slice(0, 1).toLocaleUpperCase() }}</span>
          <span class="chat-thread-copy">
            <strong :title="participant.name">{{ participant.name }}</strong>
            <small>Trực tiếp</small>
          </span>
          <span v-if="unreadChats[participant.id]" class="chat-unread">{{ unreadChats[participant.id] }}</span>
        </button>
        <div v-if="!chatParticipants.length" class="chat-thread-empty">
          Thiết bị đang kết nối sẽ xuất hiện ở đây.
        </div>
      </nav>

      <div class="chat-conversation">
        <div class="conversation-heading">
          <div class="conversation-avatar">
            {{ activeChatId === 'group' ? '#' : activeChatName.slice(0, 1).toLocaleUpperCase() }}
          </div>
          <div>
            <strong>{{ activeChatName }}</strong>
            <span>{{ activeChatId === 'group' ? 'Tin nhắn hiển thị cho mọi thiết bị kết nối.' : 'Tin nhắn chỉ được gửi đến người nhận này.' }}</span>
          </div>
        </div>

        <div class="chat-messages" aria-live="polite">
          <div v-if="visibleChatMessages.length === 0" class="empty-state">
            <span class="empty-chat-icon">{{ activeChatId === 'group' ? '#' : '…' }}</span>
            <strong v-if="isConnected">{{ activeChatId === 'group' ? 'Bắt đầu trò chuyện nhóm' : `Bắt đầu trò chuyện với ${activeChatName}` }}</strong>
            <strong v-else>Chưa có tin nhắn</strong>
            <span>{{ isConnected ? 'Chưa có tin nhắn nào trong cuộc trò chuyện này.' : 'Tin nhắn sẽ hiện ở đây sau khi kết nối.' }}</span>
          </div>
          <article
            v-for="message in visibleChatMessages"
            :key="message.id"
            class="chat-message"
            :class="{ mine: isOwnMessage(message) }"
          >
            <div class="chat-message-meta">
              <strong>{{ message.sender }}</strong>
              <time :datetime="message.sentAt">{{ formatChatTime(message.sentAt) }}</time>
            </div>
            <p>{{ message.text }}</p>
          </article>
        </div>

        <form class="chat-compose" @submit.prevent="sendChatMessage">
          <div class="compose-field">
            <textarea
              v-model="chatDraft"
              rows="2"
              maxlength="1000"
              :placeholder="activeChatId === 'group' ? 'Nhập tin nhắn cho cả nhóm...' : `Nhắn tin cho ${activeChatName}...`"
              aria-label="Tin nhắn"
              :disabled="!isConnected || chatSending"
            />
            <span class="chat-char-count">{{ chatDraft.length }}/1000</span>
          </div>
          <button class="btn btn-primary" type="submit" :disabled="!isConnected || chatSending || !chatDraft.trim()">
            {{ chatSending ? 'Đang gửi...' : 'Gửi tin nhắn' }}
          </button>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  width: 100%;
  height: calc(100vh - 88px);
  min-height: 420px;
  flex-direction: column;
  gap: 16px;
}
.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.chat-header h1 {
  margin: 0 0 5px;
  color: var(--text);
  font-size: 23px;
}
.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.connection-status.connected {
  border-color: rgba(16, 185, 129, 0.25);
  background: var(--success-subtle);
  color: var(--success-text);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94A3B8;
}
.connected .status-dot {
  background: var(--success);
}
.chat-error,
.chat-connect-hint {
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 12px;
}
.chat-connect-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.chat-connect-hint .btn {
  flex: 0 0 auto;
}
.chat-error {
  border-color: #FECACA;
  background: #FEF2F2;
  color: #991B1B;
}
.chat-card {
  display: grid;
  grid-template-columns: minmax(210px, 280px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.chat-threads {
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: #F8FAFC;
}
.chat-thread-button {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-width: 0;
  padding: 11px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.chat-thread-button:hover {
  background: #EEF2F7;
}
.chat-thread-button.active {
  background: var(--accent-subtle);
  color: var(--accent-text);
}
.chat-thread-avatar,
.conversation-avatar {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border-radius: 50%;
  background: #E2E8F0;
  color: #475569;
  font-size: 14px;
  font-weight: 700;
}
.active .chat-thread-avatar {
  background: white;
  color: var(--accent);
}
.chat-thread-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.chat-thread-copy strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-thread-copy small {
  color: var(--text-dim);
  font-size: 11px;
}
.chat-thread-label {
  padding: 20px 10px 7px;
  color: var(--text-light);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.chat-thread-empty {
  padding: 10px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.chat-unread {
  display: inline-grid;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  place-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 700;
}
.chat-conversation {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 0 22px 14px;
}
.conversation-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  border-bottom: 1px solid var(--border);
}
.conversation-heading strong,
.conversation-heading span {
  display: block;
}
.conversation-heading strong {
  margin-bottom: 4px;
  color: var(--text);
  font-size: 14px;
}
.conversation-heading span {
  color: var(--text-dim);
  font-size: 11px;
}
.chat-messages {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 18px 4px;
}
.empty-state {
  display: flex;
  min-height: 220px;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  text-align: center;
  font-size: 12px;
}
.empty-state strong {
  color: var(--text);
  font-size: 14px;
}
.empty-chat-icon {
  display: grid;
  width: 44px;
  height: 44px;
  margin-bottom: 5px;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-subtle);
  color: var(--accent);
  font-size: 20px;
  font-weight: 700;
}
.chat-message {
  align-self: flex-start;
  max-width: min(78%, 680px);
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: 13px 13px 13px 4px;
  background: #F8FAFC;
  overflow-wrap: anywhere;
}
.chat-message.mine {
  align-self: flex-end;
  border-color: var(--accent-subtle);
  border-radius: 13px 13px 4px 13px;
  background: var(--accent-subtle);
}
.chat-message-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  color: var(--text-dim);
  font-size: 11px;
}
.chat-message-meta strong {
  color: var(--text);
  font-size: 12px;
}
.chat-message-meta time {
  font-size: 10px;
}
.chat-message p {
  margin: 5px 0 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.chat-compose {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.compose-field {
  position: relative;
  min-width: 0;
  flex: 1;
}
.chat-compose textarea {
  display: block;
  width: 100%;
  min-height: 68px;
  resize: vertical;
  padding: 12px 14px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FFFFFF;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.chat-char-count {
  position: absolute;
  right: 10px;
  bottom: 7px;
  color: var(--text-light);
  font-size: 10px;
}
.chat-compose .btn {
  min-height: 40px;
}
@media (max-width: 760px) {
  .chat-view {
    height: calc(100vh - 104px);
    min-height: 360px;
  }
  .chat-card {
    grid-template-columns: minmax(140px, 190px) minmax(0, 1fr);
  }
  .chat-threads {
    padding: 7px;
  }
  .chat-thread-button {
    gap: 7px;
    padding: 9px 6px;
  }
  .chat-thread-avatar,
  .conversation-avatar {
    width: 30px;
    height: 30px;
    flex-basis: 30px;
  }
  .chat-conversation {
    padding-right: 12px;
    padding-left: 12px;
  }
  .chat-compose {
    align-items: stretch;
    flex-direction: column;
  }
}
@media (max-width: 520px) {
  .chat-connect-hint {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
