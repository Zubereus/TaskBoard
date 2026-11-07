<script setup>
import { computed } from 'vue'
import {
  vnTodayStr,
  vnDayLabel,
  formatTimeVN,
  daysBetween,
  normalizeRecurring,
  RECURRENCE_LABELS
} from '../utils/vnDate'
import { canDeleteTask, canEditTask, canToggleTask } from '../utils/taskPermissions'
import { tagColorFor } from '../utils/tagColor'

const props = defineProps({
  task: { type: Object, required: true },
  assigneeNames: { type: Array, default: () => [] },
  clientMode: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle', 'edit', 'delete'])

function priorityClass(p) {
  if ((p ?? 0) >= 50) return 'high'
  if ((p ?? 0) >= 10) return 'mid'
  return 'low'
}

function priorityLabel(p) {
  if ((p ?? 0) >= 50) return 'Cao'
  if ((p ?? 0) >= 10) return 'TB'
  return 'Thấp'
}

const dueLabel = computed(() => {
  if (!props.task.dueDate) return 'Chưa có ngày'
  const label = vnDayLabel(props.task.dueDate)
  return props.task.dueTime ? `${label}, ${formatTimeVN(props.task.dueTime)}` : label
})

const isOverdue = computed(() => {
  if (!props.task.dueDate || props.task.done) return false
  return daysBetween(vnTodayStr(), props.task.dueDate) < 0
})

const recurrenceLabel = computed(() => {
  const key = normalizeRecurring(props.task.recurring)
  return key === 'none' ? '' : RECURRENCE_LABELS[key]
})

const assigneeText = computed(() => props.assigneeNames.join(', '))
</script>

<template>
  <div class="card" :class="{ 'is-done': task.done }">
    <button
      class="check"
      :class="{ 'is-checked': task.done }"
      type="button"
      role="checkbox"
      :aria-checked="task.done"
      :aria-label="task.done ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành'"
      :disabled="!canToggleTask(task, clientMode)"
      @click.stop="emit('toggle', task)"
    >
      <span v-if="task.done" class="check-icon" aria-hidden="true">✓</span>
    </button>

    <div
      class="body"
      :class="{ 'is-readonly': !canEditTask(task, clientMode) }"
      :role="canEditTask(task, clientMode) ? 'button' : undefined"
      :tabindex="canEditTask(task, clientMode) ? 0 : undefined"
      :aria-label="canEditTask(task, clientMode) ? `Sửa công việc: ${task.title}` : undefined"
      @click="canEditTask(task, clientMode) && emit('edit', task)"
      @keydown.enter="canEditTask(task, clientMode) && emit('edit', task)"
      @keydown.space.prevent="canEditTask(task, clientMode) && emit('edit', task)"
    >
      <div class="title-row">
        <span class="title">{{ task.title }}</span>
        <div v-if="task.tags && task.tags.length" class="tag-row" aria-label="Thẻ phân loại">
          <span
            v-for="(tag, i) in task.tags"
            :key="i"
            class="tag"
            :class="`tag-${tagColorFor(tag.text, tag.color)}`"
          >
            #{{ tag.text }}
          </span>
        </div>
      </div>

      <div class="meta-row">
        <span class="due" :class="{ 'is-overdue': isOverdue }">
          <svg
            class="meta-icon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.25" />
            <polyline points="8 4.5 8 8 10.5 9.5" />
          </svg>
          {{ dueLabel }}
        </span>

        <span v-if="recurrenceLabel" class="recur" :title="`Lặp lại: ${recurrenceLabel}`">
          ↻ {{ recurrenceLabel }}
        </span>

        <span v-if="task.calendarEventId" class="synced" title="Đã đồng bộ Google Calendar">
          Google Calendar
        </span>

        <span v-if="task.personal" class="personal" title="Chỉ lưu trên máy này">
          Cá nhân
        </span>

        <span v-if="assigneeText" class="assignee" title="Người phụ trách">
          <span class="assignee-separator" aria-hidden="true">·</span>
          {{ assigneeText }}
        </span>
      </div>
    </div>

    <div
      class="priority-badge"
      :class="priorityClass(task.priority)"
      :title="`Mức ưu tiên: ${task.priority ?? 0}`"
      aria-label="Mức ưu tiên"
    >
      <span class="priority-dot" aria-hidden="true"></span>
      <span class="priority-text">{{ priorityLabel(task.priority) }}</span>
      <span class="priority-num">({{ task.priority ?? 0 }})</span>
    </div>

    <button
      v-if="canDeleteTask(task, clientMode)"
      class="delete-btn"
      type="button"
      title="Xóa công việc"
      aria-label="Xóa công việc"
      @click.stop="emit('delete', task)"
    >
      ✕
    </button>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 58px;
  padding: 10px 14px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.card:hover {
  border-color: #CBD5E1;
  background: #FCFDFE;
  box-shadow: var(--shadow-sm);
}

.card.is-done {
  opacity: 0.65;
  background: #F8FAFC;
  border-color: var(--border-subtle);
}

.card.is-done .title {
  text-decoration: line-through;
  color: var(--text-dim);
}

/* Checkbox */
.check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: 1.5px solid #CBD5E1;
  border-radius: 6px;
  background: transparent;
  color: #FFFFFF;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.check:hover:not(:disabled) {
  border-color: var(--accent);
}

.check.is-checked {
  border-color: var(--success);
  background: var(--success);
}

.check:disabled {
  cursor: default;
}

.check:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.check-icon {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

/* Body / Content */
.body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  border-radius: 4px;
}

.body.is-readonly {
  cursor: default;
}

.body:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 4px;
}

.title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.title {
  color: var(--text);
  font-size: 14px;
  font-weight: 550;
  line-height: 1.4;
  word-break: break-word;
}

/* Tags */
.tag-row {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  vertical-align: middle;
}

.tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
}

.tag-rose { background: var(--tag-rose-bg); color: var(--tag-rose-fg); }
.tag-amber { background: var(--tag-amber-bg); color: var(--tag-amber-fg); }
.tag-gray { background: var(--tag-gray-bg); color: var(--tag-gray-fg); }
.tag-blue { background: var(--tag-blue-bg); color: var(--tag-blue-fg); }
.tag-emerald { background: var(--tag-emerald-bg); color: var(--tag-emerald-fg); }

/* Meta row */
.meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 3px;
  color: var(--text-dim);
  font-size: 12px;
}

.due {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
}

.due.is-overdue {
  color: var(--danger-text);
  font-weight: 600;
}

.meta-icon {
  width: 12px;
  height: 12px;
  color: currentColor;
}

.recur {
  color: var(--success-text);
  font-weight: 500;
  white-space: nowrap;
}

.synced {
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 500;
}

.personal {
  padding: 1px 6px;
  border: 1px solid #EDE9FE;
  border-radius: 4px;
  background: #F5F3FF;
  color: #6D28D9;
  font-size: 11px;
  font-weight: 500;
}

.assignee {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 500;
}

.assignee-separator {
  color: var(--text-light);
  margin-right: 2px;
}

/* Priority badge */
.priority-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
}

.priority-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.priority-num {
  font-size: 10.5px;
  opacity: 0.85;
}

.priority-badge.high {
  border-color: rgba(239, 68, 68, 0.15);
  background: var(--tag-rose-bg);
  color: var(--tag-rose-fg);
}
.priority-badge.high .priority-dot { background: var(--pri-high); }

.priority-badge.mid {
  border-color: rgba(245, 158, 11, 0.15);
  background: var(--tag-amber-bg);
  color: var(--tag-amber-fg);
}
.priority-badge.mid .priority-dot { background: var(--pri-mid); }

.priority-badge.low {
  border-color: rgba(59, 130, 246, 0.15);
  background: var(--tag-blue-bg);
  color: var(--tag-blue-fg);
}
.priority-badge.low .priority-dot { background: var(--pri-low); }

/* Delete button */
.delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-light);
  font-size: 12px;
  opacity: 0.4;
  cursor: pointer;
  transition: opacity 0.12s ease, background-color 0.12s ease, color 0.12s ease;
}

.card:hover .delete-btn,
.delete-btn:focus-visible {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--danger-subtle);
  color: var(--danger-text);
}

.delete-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .check,
  .delete-btn,
  .body {
    transition: none !important;
  }
}
</style>
