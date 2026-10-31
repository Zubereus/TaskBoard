<script setup>
// Native <input type="date"> renders using the browser/OS locale, which on
// a Windows machine set to English-US shows mm/dd/yyyy regardless of the
// app's own language — the same class of "depends on the host machine"
// problem we already fixed for timezones. This component always displays
// and accepts dd/mm/yyyy text, and converts to/from the ISO 'yyyy-mm-dd'
// string used everywhere else in the app (storage, sorting, calendar
// sync), so the format is consistent no matter what machine it runs on.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { calendarMonthDays } from '../utils/calendar'
import { dateInputCaretPosition, displayToIso, formatDateInput } from '../utils/dateInput'
import { addMonthsStr, parseDateStr, vnTodayStr } from '../utils/vnDate'

const props = defineProps({ modelValue: String }) // ISO 'yyyy-mm-dd' or ''
const emit = defineEmits(['update:modelValue'])

function isoToDisplay(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

const text = ref(isoToDisplay(props.modelValue))
const invalid = ref(false)
const pickerRoot = ref(null)
const dateField = ref(null)
const calendarPopover = ref(null)
const calendarOpen = ref(false)
const today = vnTodayStr()
const initialMonth = parseDateStr(props.modelValue || '')
  ? props.modelValue.slice(0, 7)
  : today.slice(0, 7)
const visibleMonth = ref(`${initialMonth}-01`)
const calendarPosition = ref({ top: '0px', left: '0px' })
const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const monthLabel = computed(() => {
  const { y, m } = parseDateStr(visibleMonth.value)
  return new Intl.DateTimeFormat('vi-VN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(y, m - 1, 1)))
})

const calendarDays = computed(() =>
  calendarMonthDays(visibleMonth.value, props.modelValue || '', today)
)

watch(
  () => props.modelValue,
  (val) => {
    if (val === (displayToIso(text.value) || '')) return
    text.value = isoToDisplay(val)
    invalid.value = false
  }
)

// Accept dd/mm/yyyy with one- or two-digit day/month and pad valid dates.
function onInput(e) {
  const input = e.target
  const caret = input.selectionStart ?? input.value.length
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, '').length
  const formatted = formatDateInput(input.value)
  text.value = formatted.text
  invalid.value = formatted.invalid
  input.value = formatted.text
  nextTick(() => {
    const position = dateInputCaretPosition(formatted.text, digitsBeforeCaret)
    input.setSelectionRange(position, position)
  })
  emit('update:modelValue', formatted.iso || '')
}

function onBlur() {
  if (text.value && !displayToIso(text.value)) invalid.value = true
}

function openCalendar() {
  if (!calendarOpen.value) {
    const selected = parseDateStr(props.modelValue || '')
    visibleMonth.value = selected
      ? `${props.modelValue.slice(0, 7)}-01`
      : `${today.slice(0, 7)}-01`
    calendarOpen.value = true
    nextTick(updateCalendarPosition)
  } else {
    calendarOpen.value = false
  }
}

function updateCalendarPosition() {
  if (!dateField.value || !calendarPopover.value) return

  const fieldBounds = dateField.value.getBoundingClientRect()
  const popoverBounds = calendarPopover.value.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const left = Math.max(
    margin,
    Math.min(fieldBounds.left, window.innerWidth - popoverBounds.width - margin)
  )
  const belowTop = fieldBounds.bottom + gap
  const top = belowTop + popoverBounds.height <= window.innerHeight - margin
    ? belowTop
    : Math.max(margin, fieldBounds.top - popoverBounds.height - gap)

  calendarPosition.value = { top: `${top}px`, left: `${left}px` }
}

function changeMonth(offset) {
  visibleMonth.value = addMonthsStr(visibleMonth.value, offset)
}

function selectDate(date) {
  text.value = isoToDisplay(date)
  invalid.value = false
  emit('update:modelValue', date)
  calendarOpen.value = false
}

function clearDate() {
  text.value = ''
  invalid.value = false
  emit('update:modelValue', '')
  calendarOpen.value = false
}

function closeOnOutsideClick(event) {
  const insidePicker = pickerRoot.value && pickerRoot.value.contains(event.target)
  const insideCalendar = calendarPopover.value && calendarPopover.value.contains(event.target)
  if (!insidePicker && !insideCalendar) {
    calendarOpen.value = false
  }
}

function closeOnEscape(event) {
  if (event.key === 'Escape' && calendarOpen.value) {
    calendarOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutsideClick)
  document.addEventListener('keydown', closeOnEscape)
  window.addEventListener('resize', updateCalendarPosition)
  window.addEventListener('scroll', updateCalendarPosition, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', closeOnOutsideClick)
  document.removeEventListener('keydown', closeOnEscape)
  window.removeEventListener('resize', updateCalendarPosition)
  window.removeEventListener('scroll', updateCalendarPosition, true)
})
</script>

<template>
  <div ref="pickerRoot" class="date-picker">
    <div ref="dateField" class="date-field">
      <input
        type="text"
        inputmode="numeric"
        class="date-input"
        :class="{ invalid }"
        placeholder="dd/mm/yyyy"
        maxlength="10"
        :value="text"
        @input="onInput"
        @blur="onBlur"
      />
      <button
        type="button"
        class="calendar-trigger"
        :aria-expanded="calendarOpen"
        aria-haspopup="dialog"
        aria-label="Mở lịch chọn ngày"
        title="Chọn ngày"
        @click="openCalendar"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" stroke-width="2.5" />
        </svg>
      </button>
    </div>
    <Teleport to="body">
      <div
        v-if="calendarOpen"
        ref="calendarPopover"
        class="calendar-popover"
        :style="calendarPosition"
        role="dialog"
        aria-label="Chọn ngày hết hạn"
        @keydown.esc="calendarOpen = false"
      >
        <div class="calendar-header">
          <button type="button" class="month-nav" aria-label="Tháng trước" @click="changeMonth(-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <strong>{{ monthLabel }}</strong>
          <button type="button" class="month-nav" aria-label="Tháng sau" @click="changeMonth(1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <div class="calendar-grid calendar-weekdays" aria-hidden="true">
          <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
        </div>
        <div class="calendar-grid">
          <button
            v-for="day in calendarDays"
            :key="day.date"
            type="button"
            class="calendar-day"
            :class="{
              'outside-month': !day.inMonth,
              today: day.isToday,
              selected: day.isSelected
            }"
            :aria-label="day.date.split('-').reverse().join('/')"
            :aria-pressed="day.isSelected"
            @click="selectDate(day.date)"
          >
            {{ day.day }}
          </button>
        </div>
        <div class="calendar-footer">
          <button type="button" class="calendar-action" @click="selectDate(today)">Hôm nay</button>
          <button v-if="modelValue" type="button" class="calendar-action" @click="clearDate">Xóa ngày</button>
        </div>
      </div>
    </Teleport>
  </div>
  <span v-if="invalid" class="date-error">Ngày không hợp lệ (dd/mm/yyyy)</span>
</template>

<style scoped>
.date-picker {
  position: relative;
  width: 100%;
}
.date-field {
  position: relative;
}
.date-input {
  width: 100%;
  padding: 9px 38px 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FAFBFC;
  font-family: inherit;
  box-sizing: border-box;
}
.date-input.invalid { border-color: var(--pri-high); }
.date-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.calendar-trigger {
  position: absolute;
  top: 50%;
  right: 7px;
  display: grid;
  width: 28px;
  height: 28px;
  padding: 5px;
  place-items: center;
  transform: translateY(-50%);
  border-radius: 5px;
  color: var(--text-dim);
}
.calendar-trigger:hover,
.calendar-trigger[aria-expanded="true"] {
  background: var(--accent-subtle);
  color: var(--accent);
}
.calendar-trigger svg,
.month-nav svg {
  width: 18px;
  height: 18px;
}
.calendar-popover {
  position: fixed;
  z-index: 120;
  width: 286px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel);
  box-shadow: var(--shadow-lg);
}
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.calendar-header strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  text-transform: capitalize;
}
.month-nav {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 6px;
  color: var(--text-muted);
}
.month-nav:hover {
  background: var(--panel-hover);
  color: var(--text);
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  justify-items: center;
  gap: 3px;
}
.calendar-weekdays {
  margin-bottom: 4px;
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
}
.calendar-weekdays span {
  padding: 4px 0;
}
.calendar-day {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 50%;
  color: var(--text);
  font-size: 12px;
}
.calendar-day:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}
.calendar-day.outside-month {
  color: var(--text-light);
}
.calendar-day.today:not(.selected) {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}
.calendar-day.selected {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}
.calendar-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}
.calendar-action {
  padding: 5px 7px;
  border-radius: 5px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}
.calendar-action:hover {
  background: var(--accent-subtle);
}
.date-error {
  display: block;
  color: var(--pri-high);
  font-size: 11px;
  margin-top: 3px;
}
</style>
