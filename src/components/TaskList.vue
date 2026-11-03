<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import TaskCard from './TaskCard.vue'
import TaskForm from './TaskForm.vue'
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
let undoTimer = null
let bannerTimer = null
const taskOperations = new Set()

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
const scopeAllOption = ref(null)
const scopePersonalOption = ref(null)
const scopeSharedOption = ref(null)
let exportSuccessTimer = null
let exportCountRequestId = 0
let exportTrigger = null

// Real-time LAN sync unsubscribe
let unregisterLanSync = null

const scopeOptionRefs = {
  all: scopeAllOption,
  personal: scopePersonalOption,
  shared: scopeSharedOption
}

watch(exportScope, (scope) => {
  exportGroupByMember.value = groupByMemberForScope(scope, exportGroupByMember.value)
})

watch([tasks, exportScope, exportIncludeCompleted], refreshExportTaskCount, { deep: true, immediate: true })

watch(showExportModal, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  scopeOptionRefs[exportScope.value].value?.focus()
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
  // Subscribe to real-time sync from other LAN peers
  if (window.api?.lan?.onDataSync) {
    unregisterLanSync = window.api.lan.onDataSync(() => {
      load()
    })
  }
})

onUnmounted(() => {
  if (unregisterLanSync) unregisterLanSync()
  if (undoTimer) clearTimeout(undoTimer)
  if (bannerTimer) clearTimeout(bannerTimer)
  if (exportSuccessTimer) clearTimeout(exportSuccessTimer)
})

async function refreshExportTaskCount() {
  const requestId = ++exportCountRequestId
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

function chooseExportScope(scope, focus = false) {
  exportScope.value = scope
  if (focus) nextTick(() => scopeOptionRefs[scope].value?.focus())
}

function onScopeKeydown(event, scope) {
  const scopes = ['all', 'personal', 'shared']
  const currentIndex = scopes.indexOf(scope)
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % scopes.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex + scopes.length - 1) % scopes.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = scopes.length - 1
  else return
  event.preventDefault()
  chooseExportScope(scopes[nextIndex], true)
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
const weekDates = computed(() => currentWeekDatesVN())
const today = computed(() => vnTodayStr())

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
    if (daysBetween(weekStart, t.dueDate) < 0) {
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

const activeCount = computed(() => tasks.value.filter((t) => !t.done).length)
const doneCount = computed(() => tasks.value.filter((t) => t.done).length)
const allCount = computed(() => tasks.value.length)

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
    <header class="header">
      <div>
        <h1>Công việc</h1>
        <p class="subtitle">Bảng quản lý công việc và phân công nhiệm vụ phòng ban</p>
      </div>

      <div class="actions">
        <button class="btn btn-secondary" @click="openExportDialog">
          Xuất Word (.docx)
        </button>
        <button class="btn btn-primary" @click="openNew">
          + Công việc mới
        </button>
      </div>
    </header>

    <div class="tabs">
      <button class="tab" :class="{ active: !showCompleted && taskScope === 'all' }" @click="showCompleted = false; taskScope = 'all'">
        Chưa hoàn thành <span class="count">{{ activeCount }}</span>
      </button>
      <button class="tab" :class="{ active: showCompleted && taskScope === 'all' }" @click="showCompleted = true; taskScope = 'all'">
        Tất cả công việc <span class="count">{{ allCount }}</span>
      </button>
      <button class="tab" :class="{ active: taskScope === 'personal' }" @click="showCompleted = false; taskScope = 'personal'">
        Cá nhân
      </button>
      <button class="tab" :class="{ active: taskScope === 'shared' }" @click="showCompleted = false; taskScope = 'shared'">
        Chung
      </button>
    </div>

    <div class="task-search">
      <label class="task-search-field">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-4-4"></path>
        </svg>
        <input
          v-model="searchQuery"
          type="search"
          aria-label="Tìm công việc"
          placeholder="Tìm theo tên việc, người phụ trách, hạn, thẻ hoặc ghi chú"
          @keydown.esc="searchQuery = ''"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="task-search-clear"
          aria-label="Xóa nội dung tìm kiếm"
          title="Xóa tìm kiếm"
          @click="searchQuery = ''"
        >✕</button>
      </label>
      <span v-if="isSearchActive" class="task-search-count" role="status">
        {{ visibleTasks.length }} kết quả
      </span>
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
      v-show="group.tasks.length || group.alwaysShow"
    >
      <h2 class="day-title" :class="group.tone">
        <span class="day-name">{{ group.title }}</span>
        <span class="day-count">{{ group.tasks.length }}</span>
      </h2>
      <div v-if="group.tasks.length === 0" class="day-empty">Không có việc cần làm trong ngày này</div>
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

    <div v-if="deleteCandidate" class="delete-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <section class="delete-dialog">
        <div class="delete-icon" aria-hidden="true">!</div>
        <h2 id="delete-title">Xóa công việc?</h2>
        <p>Bạn có chắc muốn xóa công việc này không?</p>
        <strong>{{ deleteCandidate.title }}</strong>
        <div class="delete-actions">
          <button class="btn btn-ghost" @click="cancelDelete">Hủy</button>
          <button class="btn btn-danger" @click="confirmDelete">Xóa công việc</button>
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
            <div class="scope-segmented" role="radiogroup" aria-labelledby="export-scope-label">
              <button
                ref="scopeAllOption"
                type="button"
                role="radio"
                :aria-checked="exportScope === 'all'"
                :tabindex="exportScope === 'all' ? 0 : -1"
                @click="chooseExportScope('all')"
                @keydown="onScopeKeydown($event, 'all')"
              >Tất cả</button>
              <button
                ref="scopePersonalOption"
                type="button"
                role="radio"
                :aria-checked="exportScope === 'personal'"
                :tabindex="exportScope === 'personal' ? 0 : -1"
                @click="chooseExportScope('personal')"
                @keydown="onScopeKeydown($event, 'personal')"
              >Cá nhân</button>
              <button
                ref="scopeSharedOption"
                type="button"
                role="radio"
                :aria-checked="exportScope === 'shared'"
                :tabindex="exportScope === 'shared' ? 0 : -1"
                @click="chooseExportScope('shared')"
                @keydown="onScopeKeydown($event, 'shared')"
              >Chung</button>
            </div>
          </section>

          <section class="export-group">
            <div class="export-switch-row">
              <div class="export-switch-copy">
                <span id="include-completed-label" class="export-switch-label">Bao gồm việc đã hoàn thành</span>
              </div>
              <button
                type="button"
                class="toggle-switch"
                role="switch"
                :aria-checked="exportIncludeCompleted"
                aria-labelledby="include-completed-label"
                @click="exportIncludeCompleted = !exportIncludeCompleted"
              ><span></span></button>
            </div>
          </section>

          <section class="export-group">
            <div class="export-switch-row">
              <div class="export-switch-copy">
                <span id="group-by-member-label" class="export-switch-label">Chia theo thành viên</span>
                <span id="group-by-member-hint" class="export-switch-hint">
                  {{ isGroupByMemberDisabled(exportScope) ? 'Chỉ áp dụng cho công việc chung' : 'Mỗi người có một danh sách riêng.' }}
                </span>
              </div>
              <button
                type="button"
                class="toggle-switch"
                role="switch"
                :aria-checked="exportGroupByMember"
                :aria-disabled="isGroupByMemberDisabled(exportScope)"
                :disabled="isGroupByMemberDisabled(exportScope)"
                aria-labelledby="group-by-member-label"
                aria-describedby="group-by-member-hint"
                @click="exportGroupByMember = !exportGroupByMember"
              ><span></span></button>
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

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
h1 {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--text);
}
.subtitle {
  color: var(--text-dim);
  font-size: 13.5px;
  margin: 0;
}
.actions {
  display: flex;
  gap: 10px;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 22px;
  border-bottom: 1px solid var(--border);
}
.tab {
  border: none;
  background: transparent;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text-dim);
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: all 0.12s ease;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.count {
  background: var(--tag-gray-bg);
  color: var(--tag-gray-fg);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
}
.tab.active .count {
  background: var(--accent-subtle);
  color: var(--accent);
}

.task-search {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -8px 0 22px;
}
.task-search-field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel);
  color: var(--text-dim);
  box-shadow: var(--shadow-sm);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.task-search-field:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.task-search-field > svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.task-search-field input {
  width: 100%;
  min-width: 0;
  padding: 11px 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text);
}
.task-search-field input:focus {
  border: 0;
  box-shadow: none;
}
.task-search-field input::placeholder {
  color: var(--text-light);
}
.task-search-field input::-webkit-search-cancel-button {
  display: none;
}
.task-search-clear {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--text-dim);
}
.task-search-clear:hover {
  background: var(--panel-hover);
  color: var(--text);
}
.task-search-count {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 12px;
}

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
  color: var(--text-dim);
  padding: 60px 20px;
  text-align: center;
  background: var(--panel);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border);
  margin: 20px 0;
}
.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}
.empty h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px;
}
.empty p {
  font-size: 13px;
  margin: 0;
}

.day-section {
  margin-bottom: 24px;
}
.day-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.day-title.today {
  color: var(--accent);
}
.day-title.overdue {
  color: var(--pri-high);
}
.day-count {
  background: var(--tag-gray-bg);
  color: var(--tag-gray-fg);
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: normal;
}
.day-title.today .day-count {
  background: var(--accent-subtle);
  color: var(--accent);
}
.day-title.overdue .day-count {
  background: var(--tag-rose-bg);
  color: var(--tag-rose-fg);
}
.day-empty {
  color: var(--text-light);
  font-size: 12.5px;
  padding: 6px 4px 10px;
  font-style: italic;
}

.delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}
.delete-dialog {
  width: min(420px, 100%);
  padding: 26px 28px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
  text-align: center;
}
.delete-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--danger-subtle);
  color: var(--danger-text);
  font-size: 21px;
  font-weight: 800;
}
.delete-dialog h2 {
  margin: 0 0 10px;
  color: var(--text);
  font-size: 19px;
}
.delete-dialog p {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 13px;
}
.delete-dialog > strong {
  display: block;
  margin-bottom: 28px;
  color: var(--text);
  overflow-wrap: anywhere;
}
.delete-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

/* Toast Notifications */
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
.word-icon {
  font-size: 16px;
}

.undo-btn {
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #93C5FD;
  font-weight: 700;
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  transition: all 0.12s ease;
}
.undo-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: #FFFFFF;
}

.open-file-btn {
  border: none;
  background: #2563EB;
  color: #FFFFFF;
  font-weight: 700;
  font-size: 12.5px;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  transition: all 0.12s ease;
}
.open-file-btn:hover {
  background: #1D4ED8;
}

/* Export Modal */
.export-modal {
  max-width: 500px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.modal-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-icon {
  font-size: 20px;
}
.modal-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.close-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover {
  background: #F1F5F9;
  color: var(--text);
}

.export-subtitle {
  font-size: 13px;
  color: var(--text-dim);
  margin: 5px 0 0;
}

.export-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 20px;
}
.export-group h4 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.scope-segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
}
.scope-segmented button {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.scope-segmented button[aria-checked="true"] {
  border-color: var(--border);
  background: var(--panel);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.scope-segmented button:focus-visible,
.toggle-switch:focus-visible,
.close-btn:focus-visible,
.modal-footer button:focus-visible {
  outline: 3px solid var(--border-focus);
  outline-offset: 2px;
}

.export-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
.toggle-switch {
  position: relative;
  width: 42px;
  height: 24px;
  flex: 0 0 42px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #d7dce5;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.toggle-switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}
.toggle-switch[aria-checked="true"] {
  border-color: var(--accent);
  background: var(--accent);
}
.toggle-switch[aria-checked="true"] span {
  transform: translateX(18px);
}
.toggle-switch:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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

@keyframes slideUp {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
</style>
