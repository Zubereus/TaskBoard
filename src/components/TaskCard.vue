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

const props = defineProps({
  task: Object,
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
  <div class="card" :class="{ done: task.done }">
    <button
      class="check"
      :class="{ checked: task.done }"
      title="Đánh dấu hoàn thành"
      :disabled="!canToggleTask(task, clientMode)"
      @click.stop="emit('toggle', task)"
    >
      <span v-if="task.done" class="check-icon">✓</span>
    </button>

    <div class="body" :class="{ readonly: !canEditTask(task, clientMode) }" @click="canEditTask(task, clientMode) && emit('edit', task)">
      <div class="title">{{ task.title }}</div>

      <div class="tag-row" v-if="task.tags && task.tags.length">
        <span
          v-for="(tag, i) in task.tags"
          :key="i"
          class="tag"
          :class="`tag-${tag.color || 'gray'}`"
        >
          #{{ tag.text }}
        </span>
      </div>

      <div class="meta-row">
        <span class="due" :class="{ overdue: isOverdue }">
          {{ dueLabel }}
        </span>
        <span v-if="recurrenceLabel" class="recur" :title="`Lặp lại: ${recurrenceLabel}`">
          Lặp: {{ recurrenceLabel }}
        </span>
        <span v-if="task.calendarEventId" class="synced" title="Đã đồng bộ Google Calendar">
          Google Calendar
        </span>
        <span v-if="task.personal" class="personal" title="Chỉ lưu trên máy này">
          Cá nhân
        </span>
        <span v-if="assigneeText" class="assignee" title="Người phụ trách">
          {{ assigneeText }}
        </span>
      </div>
    </div>

    <div class="priority-badge" :class="priorityClass(task.priority)" :title="`Mức ưu tiên: ${task.priority ?? 0}`">
      <span class="priority-dot"></span>
      <span class="priority-text">{{ priorityLabel(task.priority) }}</span>
      <span class="priority-num">({{ task.priority ?? 0 }})</span>
    </div>

    <button v-if="canDeleteTask(task, clientMode)" class="delete-btn" title="Xóa công việc" @click.stop="emit('delete', task)">
      ✕
    </button>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  margin-bottom: 10px;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-card);
}
.card:hover {
  box-shadow: var(--shadow-hover);
  border-color: #CBD5E1;
  transform: translateY(-1px);
}
.card.done {
  opacity: 0.65;
  background: #FAFBFD;
  border-color: #E2E8F0;
}
.card.done .title {
  text-decoration: line-through;
  color: var(--text-dim);
}

.check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #CBD5E1;
  background: transparent;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: all 0.12s ease;
}
.check:hover {
  border-color: var(--accent);
  transform: scale(1.05);
}
.check:disabled {
  cursor: default;
}
.check:disabled:hover {
  border-color: var(--success);
  transform: none;
}
.check.checked {
  background: var(--success);
  border-color: var(--success);
}
.check-icon {
  font-size: 11px;
  font-weight: 700;
}

.body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.body.readonly {
  cursor: default;
}
.title {
  font-weight: 600;
  font-size: 14.5px;
  line-height: 1.45;
  color: var(--text);
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  line-height: 1.4;
}
.tag-rose { background: var(--tag-rose-bg); color: var(--tag-rose-fg); }
.tag-amber { background: var(--tag-amber-bg); color: var(--tag-amber-fg); }
.tag-gray { background: var(--tag-gray-bg); color: var(--tag-gray-fg); }
.tag-blue { background: var(--tag-blue-bg); color: var(--tag-blue-fg); }

.meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 7px;
  font-size: 12px;
  color: var(--text-dim);
}
.due {
  display: flex;
  align-items: center;
  gap: 4px;
}
.due.overdue {
  color: var(--pri-high);
  font-weight: 700;
}
.clock { font-size: 11px; }
.recur {
  color: #059669;
  font-weight: 600;
  white-space: nowrap;
}
.synced {
  color: #2563EB;
  font-weight: 500;
}
.personal {
  color: #7C3AED;
  font-weight: 600;
  background: #F5F3FF;
  padding: 1px 7px;
  border-radius: 4px;
}
.assignee {
  color: #1E293B;
  font-weight: 600;
  background: #F1F5F9;
  padding: 1px 7px;
  border-radius: 4px;
}

.priority-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 11.5px;
}
.priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.priority-num {
  font-size: 10.5px;
  opacity: 0.8;
}

.priority-badge.high {
  background: var(--tag-rose-bg);
  color: var(--tag-rose-fg);
}
.priority-badge.high .priority-dot { background: var(--pri-high); }

.priority-badge.mid {
  background: var(--tag-amber-bg);
  color: var(--tag-amber-fg);
}
.priority-badge.mid .priority-dot { background: var(--pri-mid); }

.priority-badge.low {
  background: var(--tag-blue-bg);
  color: var(--tag-blue-fg);
}
.priority-badge.low .priority-dot { background: var(--pri-low); }

.delete-btn {
  border: none;
  background: transparent;
  color: #94A3B8;
  font-size: 13px;
  padding: 6px;
  border-radius: 4px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: all 0.12s ease;
}
.card:hover .delete-btn {
  opacity: 1;
}
.delete-btn:hover {
  background: var(--danger-subtle);
  color: var(--danger-text);
}
</style>
