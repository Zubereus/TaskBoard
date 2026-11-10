<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { formatOverdueAge } from './utils/overdue'

// The tray flyout (#flyout) and the corner widget (#widget) are two views of the
// same data, fed by the main process.
const isWidget = window.location.hash === '#widget'
const WIDGET_ROW_LIMIT = 3

const agenda = ref({ alarms: [], overdue: [], dueToday: [], widgetEntries: [] })
const clockNow = ref(Date.now())
let removeListener
let clockTimer

const isEmpty = computed(
  () => !agenda.value.alarms.length && !agenda.value.overdue.length && !agenda.value.dueToday.length
)
const summary = computed(() => {
  const parts = [
    agenda.value.overdue.length ? `${agenda.value.overdue.length} quá hạn` : '',
    agenda.value.dueToday.length ? `${agenda.value.dueToday.length} hôm nay` : ''
  ].filter(Boolean)
  return parts.join(' · ')
})
const widgetRows = computed(() => agenda.value.widgetEntries.slice(0, WIDGET_ROW_LIMIT))
const widgetHidden = computed(() => agenda.value.widgetEntries.length - widgetRows.value.length)

function age(entry) {
  return formatOverdueAge(Math.floor((clockNow.value - entry.overdueSince) / 60000))
}

async function run(action) {
  try {
    await action()
  } catch (err) {
    console.warn('Không thể thực hiện thao tác:', err)
  }
}

const acknowledgeOverdue = (taskId) => run(() => window.api.overdue.acknowledge(taskId))
const acknowledgeAlarm = (taskId) => run(() => window.api.alarms.acknowledge(taskId))
const openMain = () => run(() => window.api.popup.openMain())
const dismiss = () => run(() => window.api.popup.dismissWidget())

onMounted(async () => {
  document.title = isWidget ? 'TaskBoard — Nhắc việc' : 'TaskBoard'
  removeListener = window.api.agenda.onChanged((next) => {
    agenda.value = next
  })
  clockTimer = setInterval(() => {
    clockNow.value = Date.now()
  }, 60 * 1000)
  await run(async () => {
    agenda.value = await window.api.agenda.get()
  })
})

onUnmounted(() => {
  removeListener?.()
  clearInterval(clockTimer)
})
</script>

<template>
  <main v-if="isWidget" class="popup widget" aria-live="polite">
    <header class="popup-head">
      <strong>{{ agenda.widgetEntries.length }} công việc quá hạn</strong>
      <button class="icon-btn" type="button" aria-label="Ẩn" @click="dismiss">×</button>
    </header>
    <ul class="popup-list">
      <li v-for="entry in widgetRows" :key="entry.key" class="popup-row">
        <span class="row-title">{{ entry.title }}</span>
        <span class="row-meta">{{ age(entry) }}</span>
      </li>
    </ul>
    <p v-if="widgetHidden > 0" class="more">và {{ widgetHidden }} việc khác</p>
    <footer class="popup-foot">
      <button class="btn btn-ghost" type="button" @click="dismiss">Ẩn</button>
      <button class="btn btn-primary" type="button" @click="openMain">Mở TaskBoard</button>
    </footer>
  </main>

  <main v-else class="popup flyout">
    <header class="popup-head">
      <strong>TaskBoard</strong>
      <span class="head-summary">{{ summary }}</span>
    </header>

    <div class="popup-body">
      <section v-if="agenda.alarms.length">
        <h2>Báo thức</h2>
        <div v-for="alarm in agenda.alarms" :key="alarm.taskId" class="popup-row">
          <span class="row-title">{{ alarm.title || 'Công việc cần chú ý' }}</span>
          <button class="btn btn-secondary" type="button" @click="acknowledgeAlarm(alarm.taskId)">Đã nhận</button>
        </div>
      </section>

      <section v-if="agenda.overdue.length">
        <h2>Quá hạn</h2>
        <div v-for="entry in agenda.overdue" :key="entry.key" class="popup-row">
          <span class="row-title">{{ entry.title }}</span>
          <span class="row-meta">{{ age(entry) }}</span>
          <button class="btn btn-secondary" type="button" @click="acknowledgeOverdue(entry.taskId)">Đã nhận</button>
        </div>
      </section>

      <section v-if="agenda.dueToday.length">
        <h2>Hôm nay</h2>
        <div v-for="entry in agenda.dueToday" :key="entry.taskId" class="popup-row">
          <span class="row-title">{{ entry.title }}</span>
          <span class="row-meta">{{ entry.dueTime || 'Cả ngày' }}</span>
        </div>
      </section>

      <p v-if="isEmpty" class="empty">Không có công việc cần chú ý.</p>
    </div>

    <footer class="popup-foot">
      <button class="btn btn-primary" type="button" @click="openMain">Mở TaskBoard</button>
    </footer>
  </main>
</template>

<style scoped>
.popup {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
}
.widget {
  border-color: #f1a7a0;
  background: #fff1f0;
  color: #7a1f16;
}
.popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 8px;
}
.head-summary {
  color: var(--text-dim);
  font-size: 12px;
}
.icon-btn {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.icon-btn:hover {
  background: rgba(122, 31, 22, 0.1);
}
.popup-body {
  flex: 1;
  min-height: 0;
  padding: 0 14px;
  overflow-y: auto;
}
.popup-body h2 {
  margin: 10px 0 4px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.popup-list {
  margin: 0;
  padding: 0 14px;
  list-style: none;
}
.popup-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid rgba(100, 116, 139, 0.18);
}
.widget .popup-row {
  border-top-color: rgba(122, 31, 22, 0.14);
}
.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.75;
}
.more {
  margin: 2px 14px 0;
  font-size: 12px;
  opacity: 0.8;
}
.empty {
  margin: 24px 0;
  color: var(--text-dim);
  text-align: center;
}
.popup-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 12px;
}
</style>
