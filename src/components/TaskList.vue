<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import TaskCard from './TaskCard.vue'
import TaskForm from './TaskForm.vue'
import SegmentedControl from './SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import {
  vnTodayStr,
  currentWeekDatesVN,
  vnWeekdayHeader,
  daysBetween,
  normalizeRecurring,
  nextOccurrenceDate
} from '../utils/vnDate'
import { createUndoState, nextRecurringTask, undoCompletedTask } from '../utils/taskWorkflow'
import { canEditTask, canToggleTask } from '../utils/taskPermissions'
import { matchesTaskSearch } from '../utils/taskSearch'
import {
  exportButtonDisabled,
  groupByMemberForScope,
  isGroupByMemberDisabled
} from '../utils/exportDialog'
import { countTasksForExport } from '../../server/export-filter.mjs'

const props = defineProps({
  newChatMessage: { type: Object, default: null },
  clientMode: { type: Boolean, default: false }
})
const emit = defineEmits(['open-chat'])

const tasks = ref([])
const employees = ref([])
const calendarStatus = ref({ configured: false, connected: false })
const showForm = ref(false)
const editingTask = ref(null)
const banner = ref(null)
const showCompleted = ref(false)
const taskScope = ref('all')
const searchQuery = ref('')
const undoToast = ref(null)
const deleteCandidate = ref(null)
const taskScopeOptions = [
  { value: 'all', label: 'Tất cả' },
  { value: 'personal', label: 'Cá nhân' },
  { value: 'shared', label: 'Chung' }
]
let undoTimer = null
let bannerTimer = null
let clockTimer = null
const taskOperations = new Set()

// Ticks once a minute so "today", the week sections and the header date
// roll over at midnight even if the app is left open overnight.
const clockTick = ref(0)

// Export Word modal & toast state
const showExportModal = ref(false)
const exportScope = ref('all')
const exportIncludeCompleted = ref(false)
const exportGroupByMember = ref(false)
const exportTaskCount = ref(0)
const countingExportTasks = ref(false)
const exporting = ref(false)
const exportSuccessToast = ref(null)
const exportModal = ref(null)
const exportScopeControl = ref(null)
let exportSuccessTimer = null
let exportCountRequestId = 0
let exportTrigger = null

// Real-time LAN sync unsubscribe
let unregisterLanSync = null

watch(exportScope, (scope) => {
  exportGroupByMember.value = groupByMemberForScope(scope, exportGroupByMember.value)
})

watch([tasks, exportScope, exportIncludeCompleted], refreshExportTaskCount, { deep: true, immediate: true })

watch(showExportModal, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  exportScopeControl.value?.focus()
  refreshExportTaskCount()
})

async function load() {
  try {
    tasks.value = await window.api.tasks.list()
    employees.value = await window.api.employees.list()
    calendarStatus.value = await window.api.calendar.status()
  } catch (err) {
    console.warn('Load tasks error:', err)
    flash('Không thể tải dữ liệu công việc.', true, errorDetail(err))
  }
}

onMounted(() => {
  load()
  const updateClock = () => {
    clockTick.value = clockTick.value + 1
    clockTimer = setTimeout(updateClock, 60 * 1000 - (Date.now() % (60 * 1000)))
  }
  clockTimer = setTimeout(updateClock, 60 * 1000 - (Date.now() % (60 * 1000)))
  // Subscribe to real-time sync from other LAN peers
  if (window.api?.lan?.onDataSync) {
    unregisterLanSync = window.api.lan.onDataSync(() => {
      load()
    })
  }
})

onUnmounted(() => {
  if (unregisterLanSync) unregisterLanSync()
  if (clockTimer) clearTimeout(clockTimer)
  if (undoTimer) clearTimeout(undoTimer)
  if (bannerTimer) clearTimeout(bannerTimer)
  if (exportSuccessTimer) clearTimeout(exportSuccessTimer)
})

async function refreshExportTaskCount() {
  exportCountRequestId = exportCountRequestId + 1
  const requestId = exportCountRequestId
  countingExportTasks.value = true
  try {
    const localTasks = await window.api.tasks.list()
    const count = countTasksForExport(localTasks, exportScope.value, exportIncludeCompleted.value)
    if (requestId === exportCountRequestId) exportTaskCount.value = count
  } catch (err) {
    if (requestId === exportCountRequestId) {
      flash('Không thể đếm công việc để xuất.', true, errorDetail(err))
    }
  } finally {
    if (requestId === exportCountRequestId) countingExportTasks.value = false
  }
}

function openExportDialog(event) {
  exportTrigger = event.currentTarget
  showExportModal.value = true
}

async function closeExportDialog() {
  showExportModal.value = false
  await nextTick()
  exportTrigger?.focus()
}

function trapExportDialogFocus(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeExportDialog()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = [...exportModal.value.querySelectorAll(
    'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"]):not(button)'
  )].filter((element) => element.getClientRects().length > 0)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function assigneeNamesFor(task) {
  const ids = task.assigneeIds || (task.assigneeId ? [task.assigneeId] : [])
  return ids
    .map((id) => employees.value.find((emp) => emp.id === id)?.name)
    .filter(Boolean)
}

// Visible tasks respect the "show completed" toggle.
const visibleTasks = computed(() => {
  let result = showCompleted.value ? tasks.value : tasks.value.filter((t) => !t.done)
  if (taskScope.value === 'personal') result = result.filter((t) => t.personal)
  if (taskScope.value === 'shared') result = result.filter((t) => !t.personal)
  result = result.filter((task) => matchesTaskSearch(task, searchQuery.value, employees.value))
  return result
})

const isSearchActive = computed(() => searchQuery.value.trim().length > 0)
const today = computed(() => {
  clockTick.value
  return vnTodayStr()
})
const weekDates = computed(() => {
  today.value
  return currentWeekDatesVN()
})

// ---- Header summary ------------------------------------------------------
const todayFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})
const clockFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})
const todayLabel = computed(() => {
  today.value
  return todayFormatter.format(new Date())
})
const clockLabel = computed(() => {
  clockTick.value
  return clockFormatter.format(new Date())
})
const openTasks = computed(() => tasks.value.filter((task) => !task.done && task.dueDate))
const overdueCount = computed(() => openTasks.value.filter((task) => task.dueDate < today.value).length)
const dueTodayCount = computed(() => openTasks.value.filter((task) => task.dueDate === today.value).length)

// An open task counts as overdue as soon as its day has passed, so the
// header summary and the "Quá hạn" section always agree.
const isPastDue = (task) => !task.done && task.dueDate < today.value

// Group tasks into: overdue, days of the week, later, and no date
const groups = computed(() => {
  const week = weekDates.value
  const weekStart = week[0]
  const weekEnd = week[6]

  const overdue = []
  const byDay = Object.fromEntries(week.map((d) => [d, []]))
  const later = []
  const noDate = []

  for (const t of visibleTasks.value) {
    if (!t.dueDate) {
      noDate.push(t)
      continue
    }
    if (daysBetween(weekStart, t.dueDate) < 0 || isPastDue(t)) {
      overdue.push(t)
    } else if (daysBetween(weekEnd, t.dueDate) > 0) {
      later.push(t)
    } else {
      if (byDay[t.dueDate]) byDay[t.dueDate].push(t)
      else noDate.push(t)
    }
  }

  const sortFn = (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  overdue.sort(sortFn)
  later.sort(sortFn)
  noDate.sort(sortFn)
  for (const d of week) byDay[d].sort(sortFn)

  const sections = []
  if (overdue.length) sections.push({ key: 'overdue', title: 'Quá hạn', tasks: overdue, tone: 'overdue' })
  for (const d of week) {
    sections.push({
      key: d,
      title: vnWeekdayHeader(d),
      tasks: byDay[d],
      tone: d === today.value ? 'today' : 'normal',
      alwaysShow: !isSearchActive.value
    })
  }
  if (later.length) sections.push({ key: 'later', title: 'Tuần sau trở đi', tasks: later, tone: 'normal' })
  if (noDate.length) sections.push({ key: 'nodate', title: 'Không có ngày hẹn', tasks: noDate, tone: 'normal' })
  return sections
})

const taskScopeCounts = computed(() => {
  const scopedTasks = showCompleted.value ? tasks.value : tasks.value.filter((task) => !task.done)
  return {
    all: scopedTasks.length,
    personal: scopedTasks.filter((task) => task.personal).length,
    shared: scopedTasks.filter((task) => !task.personal).length
  }
})
const scopeOptionsWithCounts = computed(() =>
  taskScopeOptions.map((option) => ({ ...option, count: taskScopeCounts.value[option.value] }))
)

function openNew() {
  editingTask.value = null
  showForm.value = true
}
function openEdit(task) {
  if (!canEditTask(task, props.clientMode)) return
  editingTask.value = task
  showForm.value = true
}

async function handleSave(payload) {
  if (editingTask.value && !canEditTask(editingTask.value, props.clientMode)) {
    flash('Máy khách không có quyền chỉnh sửa công việc chung.', true)
    return
  }
  const { addToCalendar, ...taskData } = payload
  try {
    let saved
    if (editingTask.value) {
      saved = await window.api.tasks.update(editingTask.value.id, taskData)
    } else {
      saved = await window.api.tasks.add(taskData)
    }
    showForm.value = false

    if (addToCalendar && saved?.id) {
      try {
        await window.api.calendar.sync(saved.id)
        flash('Đã đồng bộ với Google Calendar.')
      } catch (err) {
        flash('Đã lưu công việc nhưng không thể đồng bộ Google Calendar.', true, errorDetail(err))
      }
    }
    await load()
  } catch (err) {
    flash('Không thể lưu công việc.', true, errorDetail(err))
  }
}

async function toggleDone(task) {
  if (!canToggleTask(task, props.clientMode)) return
  if (taskOperations.has(task.id)) return
  taskOperations.add(task.id)
  try {
    const wasDone = task.done
    await window.api.tasks.update(task.id, { done: !wasDone })

    let createdNextId = null
    const interval = normalizeRecurring(task.recurring)
    if (!wasDone && interval !== 'none' && task.dueDate) {
      const nextDate = nextOccurrenceDate(
        task.dueDate,
        interval,
        task.recurrenceAnchorDate || task.dueDate
      )
      if (nextDate) {
        const created = await window.api.tasks.add(nextRecurringTask({ ...task, recurring: interval }, nextDate))
        createdNextId = created?.id || null
        flash(`Đã tạo việc lặp lại tiếp theo, hạn ${nextDate.split('-').reverse().join('/')}.`)
      }
    }

    await load()

    if (!wasDone && (!props.clientMode || task.personal)) {
      showUndo(task, createdNextId)
    }
  } catch (err) {
    flash('Không thể cập nhật trạng thái công việc.', true, errorDetail(err))
  } finally {
    taskOperations.delete(task.id)
  }
}

function showUndo(task, createdNextId) {
  if (undoTimer) clearTimeout(undoTimer)
  undoToast.value = createUndoState(task, createdNextId)
  undoTimer = setTimeout(() => {
    undoToast.value = null
    undoTimer = null
  }, 6000)
}

async function undoComplete() {
  if (!undoToast.value) return
  const undoState = undoToast.value
  if (taskOperations.has(undoState.id)) return
  taskOperations.add(undoState.id)
  try {
    const { id, createdNextId, recurrenceSourceId } = undoState
    if (undoTimer) clearTimeout(undoTimer)
    undoToast.value = null
    undoTimer = null
    await undoCompletedTask({ id, createdNextId, recurrenceSourceId }, window.api.tasks)
    await load()
  } catch (err) {
    flash('Không thể hoàn tác công việc.', true, errorDetail(err))
  } finally {
    taskOperations.delete(undoState.id)
  }
}

async function remove(task) {
  if (props.clientMode && !task.personal) return
  deleteCandidate.value = task
}

function cancelDelete() {
  deleteCandidate.value = null
}

async function confirmDelete() {
  const task = deleteCandidate.value
  if (!task) return
  deleteCandidate.value = null
  try {
    await window.api.tasks.delete(task.id)
    await load()
  } catch (err) {
    flash('Không thể xóa công việc.', true, errorDetail(err))
  }
}

function errorDetail(err) {
  if (!err) return 'Không nhận được thông tin chi tiết từ ứng dụng.'
  const message = err.message || String(err)
  const code = err.code ? ` (${err.code})` : ''
  return `${message}${code}`
}

function flash(msg, isError = false, detail = '') {
  if (bannerTimer) clearTimeout(bannerTimer)
  banner.value = { msg, detail, isError }
  bannerTimer = setTimeout(() => {
    banner.value = null
    bannerTimer = null
  }, isError ? 8000 : 4000)
}

// DOCX Export handler
async function runDocxExport() {
  exporting.value = true
  try {
    const res = await window.api.export.tasksDocx({
      scope: exportScope.value,
      includeCompleted: exportIncludeCompleted.value,
      groupByMember: exportGroupByMember.value
    })
    if (res && !res.canceled && res.filePath) {
      showExportModal.value = false
      exportSuccessToast.value = {
        filePath: res.filePath,
        fileName: res.fileName
      }
      if (exportSuccessTimer) clearTimeout(exportSuccessTimer)
      exportSuccessTimer = setTimeout(() => {
        exportSuccessToast.value = null
      }, 10000)
    }
  } catch (err) {
    flash('Không thể xuất tệp Word: ' + (err.message || err), true)
  } finally {
    exporting.value = false
  }
}

async function openExportedFile(filePath) {
  if (window.api?.export?.openFile && filePath) {
    await window.api.export.openFile(filePath)
  }
}
</script>

<template>
  <div class="task-list-view">
    <header class="page-head">
      <div class="page-title">
        <h1>Công việc</h1>
        <p class="subline">
          {{ todayLabel }} · <span class="clock">{{ clockLabel }}</span> ·
          <template v-if="overdueCount">
            <strong class="alert">{{ overdueCount }} việc quá hạn</strong><template v-if="dueTodayCount">, {{ dueTodayCount }} việc đến hạn hôm nay</template>.
          </template>
          <template v-else-if="dueTodayCount">{{ dueTodayCount }} việc đến hạn hôm nay.</template>
          <template v-else>Không có việc nào quá hạn.</template>
        </p>
      </div>

      <div class="actions">
        <button class="btn btn-secondary" @click="openExportDialog">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          Xuất Word
        </button>
        <button class="btn btn-primary" @click="openNew">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Công việc mới
        </button>
      </div>
    </header>

    <div class="toolbar">
      <div class="toolbar-primary">
        <SegmentedControl
          v-model="taskScope"
          :options="scopeOptionsWithCounts"
          label="Phạm vi công việc"
        />
        <div class="completed-toggle">
          <span id="completed-toggle-label">Hiện việc đã hoàn thành</span>
          <ToggleSwitch v-model="showCompleted" labelledby="completed-toggle-label" />
        </div>
      </div>

      <label class="search" title="Tìm theo tên việc, người phụ trách, hạn, thẻ hoặc ghi chú">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-4-4"></path>
        </svg>
        <input
          v-model="searchQuery"
          type="search"
          aria-label="Tìm công việc"
          placeholder="Tìm việc, người phụ trách…"
          @keydown.esc="searchQuery = ''"
        />
        <span v-if="isSearchActive" class="search-count" role="status">
          {{ visibleTasks.length }} kết quả
        </span>
        <button
          v-if="searchQuery"
          type="button"
          class="search-clear"
          aria-label="Xóa nội dung tìm kiếm"
          title="Xóa tìm kiếm"
          @click="searchQuery = ''"
        >✕</button>
      </label>
    </div>

    <div v-if="newChatMessage" class="chat-notice" role="status" aria-live="polite">
      <span class="chat-notice-dot"></span>
      <div class="chat-notice-copy">
        <strong>Có tin nhắn mới từ {{ newChatMessage.sender }}</strong>
        <span>{{ newChatMessage.text }}</span>
      </div>
      <button class="chat-notice-action" @click="emit('open-chat')">Mở trò chuyện</button>
    </div>

    <div v-if="banner" class="banner" :class="{ error: banner.isError }" role="alert">
      <strong>{{ banner.msg }}</strong>
      <span v-if="banner.detail" class="error-detail">{{ banner.detail }}</span>
    </div>

    <div v-if="visibleTasks.length === 0" class="empty">
      <h3>{{ isSearchActive ? 'Không tìm thấy công việc phù hợp' : 'Không có công việc nào' }}</h3>
      <p v-if="isSearchActive">Thử từ khóa khác hoặc xóa nội dung tìm kiếm.</p>
      <p v-else>Nhấn "+ Công việc mới" để thêm việc cần làm.</p>
    </div>

    <section
      v-for="group in groups"
      :key="group.key"
      class="day-section"
      :class="{ 'is-empty': group.tasks.length === 0 }"
      v-show="group.tasks.length || group.alwaysShow"
    >
      <h2 class="day-title" :class="group.tone">
        <span class="day-name">{{ group.title }}</span>
        <span v-if="group.tone === 'today'" class="day-flag">Hôm nay</span>
        <span v-if="group.tasks.length" class="day-count">{{ group.tasks.length }}</span>
        <span v-else class="day-none">Không có việc</span>
      </h2>
      <div v-if="group.tasks.length" class="task-cards-list">
        <TaskCard
          v-for="task in group.tasks"
          :key="task.id"
          :task="task"
          :assignee-names="assigneeNamesFor(task)"
          :client-mode="clientMode"
          @toggle="toggleDone"
          @edit="openEdit"
          @delete="remove"
        />
      </div>
    </section>

    <!-- Create / Edit Form Modal -->
    <TaskForm
      v-if="showForm"
      :task="editingTask"
      :calendar-connected="calendarStatus.connected"
      :employees="employees"
      @save="handleSave"
      @close="showForm = false"
    />

    <div v-if="deleteCandidate" class="delete-overlay" role="presentation" @click.self="cancelDelete">
      <section class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <button class="delete-close" type="button" aria-label="Đóng" @click="cancelDelete">×</button>
        <h2 id="delete-title">Xóa công việc?</h2>
        <p id="delete-description">
          Công việc “<strong>{{ deleteCandidate.title }}</strong>” sẽ bị xóa vĩnh viễn.<br>
          Thao tác này không thể hoàn tác.
        </p>
        <div class="delete-actions">
          <button class="btn btn-ghost" type="button" @click="cancelDelete">Hủy</button>
          <button class="btn btn-danger" type="button" @click="confirmDelete">Xóa công việc</button>
        </div>
      </section>
    </div>

    <!-- Undo Toast when checking off task -->
    <div v-if="undoToast" class="undo-toast">
      <div class="undo-message">
        <span class="check-icon">✓</span>
        <span>Đã hoàn thành: <strong>{{ undoToast.title }}</strong></span>
      </div>
      <button class="undo-btn" @click="undoComplete">Hoàn tác</button>
    </div>

    <!-- Export Word Success Toast -->
    <div v-if="exportSuccessToast" class="export-toast">
      <div class="export-msg">
        <span>Đã lưu bảng công việc: <strong>{{ exportSuccessToast.fileName }}</strong></span>
      </div>
      <button class="open-file-btn" @click="openExportedFile(exportSuccessToast.filePath)">
        Mở tệp ngay
      </button>
    </div>

    <!-- DOCX Export Options Modal -->
    <div v-if="showExportModal" class="overlay" @click.self="closeExportDialog">
      <div
        ref="exportModal"
        class="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        @keydown="trapExportDialogFocus"
      >
        <div class="modal-header">
          <div>
            <h3 id="export-dialog-title">Xuất công việc ra Word</h3>
            <p class="export-subtitle">Khổ giấy A4.</p>
          </div>
          <button class="close-btn" aria-label="Đóng" @click="closeExportDialog">✕</button>
        </div>

        <div class="export-groups">
          <section class="export-group" aria-labelledby="export-scope-label">
            <h4 id="export-scope-label">Phạm vi</h4>
            <SegmentedControl
              ref="exportScopeControl"
              v-model="exportScope"
              :options="taskScopeOptions"
              labelledby="export-scope-label"
              block
            />
          </section>

          <section class="export-group">
            <div class="export-switch-row">
              <div class="export-switch-copy">
                <span id="include-completed-label" class="export-switch-label">Bao gồm việc đã hoàn thành</span>
              </div>
              <ToggleSwitch v-model="exportIncludeCompleted" labelledby="include-completed-label" />
            </div>
          </section>

          <section class="export-group">
            <div
              class="export-switch-row"
              :class="{ 'is-disabled': isGroupByMemberDisabled(exportScope) }"
            >
              <div class="export-switch-copy">
                <span id="group-by-member-label" class="export-switch-label">Chia theo thành viên</span>
                <span id="group-by-member-hint" class="export-switch-hint">
                  {{ isGroupByMemberDisabled(exportScope) ? 'Chỉ áp dụng cho công việc chung' : 'Mỗi người có một danh sách riêng.' }}
                </span>
              </div>
              <ToggleSwitch
                v-model="exportGroupByMember"
                :disabled="isGroupByMemberDisabled(exportScope)"
                labelledby="group-by-member-label"
                describedby="group-by-member-hint"
              />
            </div>
          </section>
        </div>

        <p class="export-count" role="status" aria-live="polite">
          <template v-if="countingExportTasks">Đang đếm công việc...</template>
          <template v-else-if="exportTaskCount === 0">Không có công việc nào để xuất</template>
          <template v-else>Sẽ xuất {{ exportTaskCount }} công việc</template>
        </p>

        <div class="modal-footer">
          <button class="btn btn-ghost" :disabled="exporting" @click="closeExportDialog">
            Hủy
          </button>
          <button
            class="btn btn-primary"
            :disabled="exportButtonDisabled(exportTaskCount, exporting, countingExportTasks)"
            @click="runDocxExport"
          >
            {{ exporting ? 'Đang tạo tệp...' : 'Lưu tệp Word' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-list-view {
  position: relative;
}

/* ---- Page header ---- */
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
h1 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}
.subline {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13.5px;
  font-weight: 450;
  line-height: 1.45;
}
.subline .alert {
  color: var(--danger-text);
  font-weight: 600;
}
.clock {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-weight: 500;
}
.actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
}
.actions .btn-secondary {
  color: var(--text);
}

/* ---- Toolbar ---- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.toolbar-primary {
  display: flex;
  flex: 1 0 100%;
  max-width: 760px;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.completed-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  user-select: none;
}
.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 280px;
  max-width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text-dim);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(54, 116, 192, 0.12);
}
.search > svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: var(--text-dim);
}
.search input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.search input:focus {
  outline: none;
  box-shadow: none;
}
.search input::placeholder {
  color: var(--text-light);
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.search-count {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
}
.search-clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 50%;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
}
.search-clear:hover {
  background: var(--panel-hover);
  color: var(--text);
}

@media (max-width: 860px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .toolbar-primary {
    max-width: 100%;
  }
  .search {
    width: 100%;
  }
}
@media (max-width: 540px) {
  .toolbar-primary {
    gap: 10px 16px;
  }
}

/* ---- Notices ---- */
.chat-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -10px 0 18px;
  padding: 11px 14px;
  border: 1px solid #FECACA;
  border-radius: var(--radius-md);
  background: #FEF2F2;
  color: #991B1B;
}
.chat-notice-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #DC2626;
}
.chat-notice-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.chat-notice-copy strong {
  font-size: 12.5px;
}
.chat-notice-copy span {
  overflow: hidden;
  color: #7F1D1D;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-notice-action {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: #B91C1C;
  font-size: 12px;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.banner {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 100;
  width: min(420px, calc(100vw - 48px));
  padding: 10px 14px;
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-sm);
  background: var(--success-subtle);
  color: var(--success-text);
  font-size: 13px;
}
.banner.error {
  background: var(--danger-subtle);
  color: var(--danger-text);
  border-color: rgba(239, 68, 68, 0.2);
}
.banner strong,
.error-detail {
  display: block;
}
.error-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.empty {
  margin: 20px 0;
  padding: 56px 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel);
  color: var(--text-dim);
  text-align: center;
}
.empty h3 {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
}
.empty p {
  margin: 0;
  font-size: 13px;
}

/* ---- Day sections ---- */
.day-section {
  margin-bottom: 22px;
}
.day-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.day-title.today {
  color: var(--accent);
}
.day-title.overdue {
  color: var(--danger-text);
}
.day-flag {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
}
.day-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--border-subtle);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
}
.day-title.overdue .day-count {
  background: var(--tag-rose-bg);
  color: var(--tag-rose-fg);
}
.day-none {
  margin-left: auto;
  color: var(--text-light);
  font-size: 12px;
  font-weight: 450;
}

.day-section.is-empty {
  margin-bottom: 0;
}
.day-section.is-empty .day-title {
  margin: 0;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
}
.day-section.is-empty .day-title.today {
  color: var(--accent);
  font-weight: 600;
}
.day-section.is-empty + .day-section:not(.is-empty) {
  margin-top: 18px;
}

.task-cards-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---- Delete dialog ---- */
.delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.28);
}
.delete-dialog {
  position: relative;
  width: min(360px, 100%);
  padding: 20px 18px 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
}
.delete-dialog h2 {
  margin: 0 32px 8px 0;
  color: var(--text);
  font-size: 17px;
  font-weight: 650;
}
.delete-dialog p {
  margin: 0 0 20px;
  color: var(--text-dim);
  font-size: 13.5px;
  line-height: 1.5;
}
.delete-dialog p strong {
  color: var(--text);
  overflow-wrap: anywhere;
}
.delete-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim);
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
}
.delete-close:hover {
  background: #F1F2F4;
  color: var(--text);
}
.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.delete-actions .btn {
  min-height: 38px;
  padding: 8px 16px;
  border-radius: 11px;
  font-size: 13px;
}
.delete-actions .btn-ghost {
  background: #FFFFFF;
  border-color: #D7D7DC;
  color: var(--text);
}
.delete-actions .btn-danger {
  border-color: #E92735;
  background: #E92735;
  color: #FFFFFF;
}
.delete-actions .btn-danger:hover {
  border-color: #D91F2D;
  background: #D91F2D;
}

/* ---- Toasts ---- */
.undo-toast, .export-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  background: #0F172A;
  color: #FFFFFF;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.35);
  z-index: 60;
  animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.undo-message, .export-msg {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check-icon {
  background: #10B981;
  color: #FFFFFF;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}
.undo-btn {
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #93C5FD;
  font-weight: 700;
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}
.undo-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: #FFFFFF;
}
.open-file-btn {
  border: none;
  background: var(--accent);
  color: #FFFFFF;
  font-weight: 700;
  font-size: 12.5px;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}
.open-file-btn:hover {
  background: var(--accent-hover);
}

/* ---- Export modal ---- */
.export-modal {
  max-width: 500px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.close-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.close-btn:hover {
  background: #F1F5F9;
  color: var(--text);
}
.export-subtitle {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 13px;
}
.export-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 20px;
}
.export-group h4 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.export-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.export-switch-row.is-disabled {
  opacity: 0.55;
}
.export-switch-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.export-switch-label {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.export-switch-hint {
  color: var(--text-dim);
  font-size: 12px;
}
.export-count {
  min-height: 20px;
  margin: 18px 0 16px;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.close-btn:focus-visible,
.modal-footer button:focus-visible,
.search-clear:focus-visible,
.chat-notice-action:focus-visible,
.delete-close:focus-visible,
.undo-btn:focus-visible,
.open-file-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

@keyframes slideUp {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .search,
  .btn,
  .undo-toast,
  .export-toast,
  .delete-close,
  .close-btn,
  .undo-btn,
  .open-file-btn {
    transition: none !important;
    animation: none !important;
  }
}
</style>
