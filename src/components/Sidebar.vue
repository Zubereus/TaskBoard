<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import logo from '../assets/logo.svg'

defineProps({
  modelValue: String,
  chatUnreadCount: { type: Number, default: 0 }
})
const emit = defineEmits(['update:modelValue'])

const items = [
  { key: 'tasks', label: 'Công việc' },
  { key: 'stats', label: 'Thống kê' },
  { key: 'team', label: 'Nhóm' },
  { key: 'chat', label: 'Trò chuyện' },
  { key: 'lan', label: 'Đồng bộ LAN' }
]

const lanStatus = ref(null)
let unsubscribe = null

async function updateLanStatus() {
  try {
    if (window.api?.lan?.getStatus) {
      lanStatus.value = await window.api.lan.getStatus()
    }
  } catch {
    // ignore
  }
}

onMounted(async () => {
  await updateLanStatus()
  if (window.api?.lan?.onStatusChange) {
    unsubscribe = window.api.lan.onStatusChange((status) => {
      lanStatus.value = status
    })
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

const lanPill = computed(() => {
  if (!lanStatus.value) return { text: 'Cục bộ', type: 'offline' }
  if (lanStatus.value.mode === 'host') {
    return {
      text: `Host (${lanStatus.value.host?.clientCount || 0})`,
      detail: lanStatus.value.primaryIp,
      type: 'online'
    }
  }
  if (lanStatus.value.mode === 'client') {
    if (lanStatus.value.client?.connected) {
      return {
        text: 'Đã kết nối',
        detail: lanStatus.value.client?.targetHost,
        type: 'online'
      }
    }
    return {
      text: 'Đang kết nối...',
      detail: lanStatus.value.client?.targetHost || 'LAN',
      type: 'connecting'
    }
  }
  return {
    text: 'Cục bộ',
    detail: 'Chỉ trên máy này',
    type: 'offline'
  }
})
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <img class="brand-mark" :src="logo" alt="TaskBoard" />
      <div class="brand-text">
        <span class="brand-name">TaskBoard</span>
      </div>
    </div>

    <nav class="nav-list">
      <button
        v-for="item in items"
        :key="item.key"
        class="nav-item"
        :class="{ active: modelValue === item.key }"
        @click="emit('update:modelValue', item.key)"
      >
        <span class="nav-icon">
          <!-- Tasks icon -->
          <svg v-if="item.key === 'tasks'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <!-- Stats icon -->
          <svg v-else-if="item.key === 'stats'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <!-- Team icon -->
          <svg v-else-if="item.key === 'team'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <!-- Chat icon -->
          <svg v-else-if="item.key === 'chat'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.5 8.5 0 0 1-12.8 7.3L3 20l1.2-4.3A8.5 8.5 0 1 1 21 11.5Z"/>
          </svg>
          <!-- LAN icon -->
          <svg v-else-if="item.key === 'lan'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="6" height="6" rx="1"/>
            <rect x="16" y="2" width="6" height="6" rx="1"/>
            <rect x="9" y="16" width="6" height="6" rx="1"/>
            <path d="M5 8v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
            <path d="M12 12v4"/>
          </svg>
          <!-- Settings icon -->
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </span>
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="item.key === 'chat' && chatUnreadCount" class="chat-unread-badge">
          {{ chatUnreadCount > 99 ? '99+' : chatUnreadCount }}
        </span>
        <span v-if="item.key === 'lan' && lanPill.type === 'online'" class="nav-indicator online"></span>
      </button>
    </nav>

    <div class="sidebar-tools">
      <button
        class="help-link"
        :class="{ active: modelValue === 'help' }"
        @click="emit('update:modelValue', 'help')"
      >
        <span class="help-icon">?</span>
        <span>Hướng dẫn sử dụng</span>
      </button>
    </div>

    <div class="sidebar-footer">
      <div
        class="lan-widget"
        :class="lanPill.type"
        title="Nhấp để cấu hình Mạng LAN"
        @click="emit('update:modelValue', 'lan')"
      >
        <div class="widget-row">
          <span class="pulse-dot" :class="lanPill.type"></span>
          <span class="widget-title">{{ lanPill.text }}</span>
        </div>
        <div class="widget-detail">{{ lanPill.detail }}</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 20px 14px 16px;
  box-shadow: 1px 0 3px rgba(15, 23, 42, 0.02);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 24px;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  clip-path: inset(0 round 7px);
  display: block;
}
.brand-text {
  display: flex;
  flex-direction: column;
}
.brand-name {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--text);
  line-height: 1.2;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 13.5px;
  transition: all 0.12s ease;
  position: relative;
}
.nav-item:hover {
  background: #F1F5F9;
  color: var(--text);
}
.nav-item.active {
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-weight: 700;
}

.nav-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
}
.nav-label {
  flex: 1;
}

.chat-unread-badge {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #DC2626;
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.nav-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.nav-indicator.online {
  background: var(--success);
}

.sidebar-footer {
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.sidebar-tools {
  padding-top: 12px;
  margin-bottom: 10px;
  border-top: 1px solid var(--border-subtle);
}
.help-link {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.help-link:hover,
.help-link.active {
  background: var(--accent-subtle);
  color: var(--accent-text);
}
.help-icon {
  width: 17px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}

.lan-widget {
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}
.lan-widget:hover {
  background: #F1F5F9;
}
.lan-widget.online {
  background: var(--success-subtle);
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.lan-widget.connecting {
  background: var(--warning-subtle);
  border: 1px solid rgba(245, 158, 11, 0.25);
}
.lan-widget.offline .widget-detail {
  font-family: inherit;
}

.widget-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.widget-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.lan-widget.online .widget-title {
  color: var(--success-text);
}
.lan-widget.connecting .widget-title {
  color: var(--warning-text);
}
.widget-detail {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: 14px;
  font-family: var(--font-mono);
}
</style>
