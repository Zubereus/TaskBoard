<script setup>
import { ref, watch, computed } from 'vue'
import DateInput from './DateInput.vue'
import { normalizeRecurring } from '../utils/vnDate'
import { normalizeReminderDays } from '../utils/taskWorkflow'

const props = defineProps({ task: Object, calendarConnected: Boolean, employees: Array })
const emit = defineEmits(['save', 'close'])

const form = ref(blankForm())

// Native range inputs fill their track up to the thumb's *center*, but the
// thumb itself has width — so even at max value there's always a visible
// gap between the fill and the track's right edge. We draw the fill
// ourselves via a background gradient instead, so it reaches exactly 0%
// and 100% with no native-rendering gap.
const priorityPct = computed(() => Number(form.value.priority))
const priorityTrackStyle = computed(() => ({
  background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${priorityPct.value}%, var(--border) ${priorityPct.value}%, var(--border) 100%)`
}))

function blankForm() {
  return {
    title: '',
    tagsText: '',
    dueDate: '',
    dueTime: '',
    priority: 30,
    recurring: 'none',
    notes: '',
    assigneeIds: [],
    reminderDays: [],
    reminderCustomDays: '',
    alarmEnabled: false,
    visibility: 'shared',
    addToCalendar: false
  }
}

function toggleAssignee(id) {
  const idx = form.value.assigneeIds.indexOf(id)
  if (idx === -1) form.value.assigneeIds.push(id)
  else form.value.assigneeIds.splice(idx, 1)
}

watch(
  () => props.task,
  (t) => {
    if (t) {
      form.value = {
        title: t.title || '',
        tagsText: (t.tags || []).map((tg) => tg.text).join(', '),
        dueDate: t.dueDate || '',
        dueTime: t.dueTime || '',
        priority: t.priority ?? 30,
        recurring: normalizeRecurring(t.recurring),
        notes: t.notes || '',
        assigneeIds: [...(t.assigneeIds || (t.assigneeId ? [t.assigneeId] : []))],
        reminderDays: (t.reminderDays || []).filter((days) => [1, 2, 3, 7].includes(Number(days))),
        reminderCustomDays:
          (t.reminderDays || []).find((days) => ![1, 2, 3, 7].includes(Number(days))) || '',
        alarmEnabled: !!t.alarmEnabled,
        visibility: t.personal ? 'personal' : 'shared',
        addToCalendar: !!t.calendarEventId
      }
    } else {
      form.value = blankForm()
    }
  },
  { immediate: true }
)

function submit() {
  const title = form.value.title.trim()
  if (!title) return

  const tags = form.value.tagsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ text, color: 'gray' }))

  emit('save', {
    title,
    tags,
    dueDate: form.value.dueDate,
    dueTime: form.value.dueDate ? form.value.dueTime : '',
    priority: Number(form.value.priority),
    recurring: form.value.recurring,
    notes: form.value.notes.trim(),
    // Send a plain array across Electron IPC; Vue keeps this field reactive.
    assigneeIds: [...form.value.assigneeIds],
    reminderDays: normalizeReminderDays([
      ...new Set([
        ...form.value.reminderDays.map(Number),
        ...(form.value.reminderCustomDays ? [Number(form.value.reminderCustomDays)] : [])
      ])
    ]),
    alarmEnabled: !!form.value.alarmEnabled && !!form.value.dueDate,
    personal: form.value.visibility === 'personal',
    addToCalendar: form.value.addToCalendar
  })
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <h3>{{ task ? 'Sửa công việc' : 'Công việc mới' }}</h3>

      <label>Tiêu đề</label>
      <input v-model="form.title" placeholder="Cần làm gì?" autofocus />

      <label>Thẻ (cách nhau bằng dấu phẩy)</label>
      <input v-model="form.tagsText" placeholder="Khẩn, Quan trọng" />

      <div class="row">
        <div class="col">
          <label>Ngày hết hạn</label>
          <DateInput v-model="form.dueDate" />
        </div>
        <div class="col">
          <label>Giờ (tùy chọn)</label>
          <input type="time" v-model="form.dueTime" :disabled="!form.dueDate" />
        </div>
      </div>

      <label>Độ ưu tiên ({{ form.priority }})</label>
      <input type="range" min="0" max="100" v-model="form.priority" class="priority-slider" :style="priorityTrackStyle" />

      <label>Ghi chú (tùy chọn)</label>
      <textarea v-model="form.notes" rows="2" placeholder="Chi tiết thêm..."></textarea>

      <label>Giao cho (có thể chọn nhiều người)</label>
      <div v-if="employees.length === 0" class="no-employees">Chưa có thành viên nào. Thêm ở tab “Nhóm”.</div>
      <div v-else class="assignee-list">
        <label v-for="e in employees" :key="e.id" class="assignee-item">
          <input
            type="checkbox"
            :checked="form.assigneeIds.includes(e.id)"
            @change="toggleAssignee(e.id)"
          />
          {{ e.name }}
        </label>
      </div>

      <label>Lặp lại</label>
      <select v-model="form.recurring">
        <option value="none">Không lặp lại</option>
        <option value="daily">Hằng ngày</option>
        <option value="weekly">Hằng tuần</option>
        <option value="monthly">Hằng tháng</option>
        <option value="quarterly">Hằng quý</option>
        <option value="yearly">Hằng năm</option>
      </select>
      <p v-if="form.recurring !== 'none' && !form.dueDate" class="disabled-hint recurring-hint">
        Cần đặt ngày hết hạn để việc lặp lại hoạt động.
      </p>

      <label v-if="form.dueDate">Nhắc trước hạn (gửi một lần ở mỗi mốc)</label>
      <div v-if="form.dueDate" class="reminder-list">
        <label v-for="option in [1, 2, 3, 7]" :key="option" class="checkbox-row reminder-option">
          <input type="checkbox" :value="option" v-model="form.reminderDays" />
          {{ option }} ngày trước
        </label>
        <label class="custom-reminder reminder-option">
          <span>Mốc khác:</span>
          <input
            v-model="form.reminderCustomDays"
            type="number"
            min="1"
            max="365"
            step="1"
            placeholder="số ngày"
          />
          <span>ngày trước</span>
        </label>
      </div>

      <label v-if="form.dueDate" class="checkbox-row alarm-option">
        <input type="checkbox" v-model="form.alarmEnabled" :disabled="!form.dueDate" />
        Báo thức lặp mỗi 1 giờ đến khi tôi xác nhận
      </label>

      <label>Phạm vi công việc</label>
      <select v-model="form.visibility">
        <option value="shared">Công việc chung (đồng bộ với nhóm)</option>
        <option value="personal">Công việc cá nhân (chỉ trên máy này)</option>
      </select>

      <label class="checkbox-row" v-if="form.dueDate">
        <input type="checkbox" v-model="form.addToCalendar" :disabled="!calendarConnected" />
        Thêm vào Google Calendar
        <span v-if="!calendarConnected" class="disabled-hint">(kết nối trong Hướng dẫn sử dụng trước)</span>
      </label>

      <div class="actions">
        <button class="btn btn-ghost" @click="emit('close')">Hủy</button>
        <button class="btn btn-primary" :disabled="!form.title.trim()" @click="submit">
          {{ task ? 'Lưu thay đổi' : 'Tạo công việc' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 440px;
  max-width: 90vw;
  background: var(--panel);
  border-radius: var(--radius-lg);
  padding: 24px 26px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  max-height: 88vh;
  overflow-y: auto;
}
h3 { margin: 0 0 16px; font-size: 17px; }
label { display: block; font-size: 12px; font-weight: 600; color: var(--text-dim); margin: 12px 0 6px; }
input, select, textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FAFBFC;
  font-family: inherit;
}
textarea { resize: vertical; }
.row { display: flex; gap: 14px; }
.col { flex: 1; }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); font-weight: 500; }
.checkbox-row input { width: auto; }
.reminder-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FAFBFC;
}
.reminder-option {
  display: flex;
  width: auto;
  margin: 0 14px 0 0;
  align-items: center;
  justify-content: center;
}
.custom-reminder input {
  width: 82px;
  padding: 5px 7px;
  margin: 0 4px;
}
.disabled-hint { color: var(--text-dim); font-weight: 400; font-size: 11.5px; }
.recurring-hint { margin: 4px 0 0; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }

.no-employees { color: var(--text-dim); font-size: 12.5px; }
.assignee-list {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FAFBFC;
  padding: 4px 10px;
  max-height: 140px;
  overflow-y: auto;
}
.assignee-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  padding: 6px 0;
  margin: 0;
}
.assignee-item input { width: auto; }

/* Custom range slider: the fill color comes entirely from the inline
   gradient background bound to priorityTrackStyle, so we strip the
   browser's own track rendering (which is what left a gap at the end)
   and just style a thin rounded track + a round thumb on top of it. */
.priority-slider {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.priority-slider::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  background: transparent; /* fill comes from the inline gradient on the input itself */
}
.priority-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  margin-top: -5px;
  cursor: pointer;
}
.priority-slider::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: transparent;
}
.priority-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  cursor: pointer;
}
</style>
