// Vietnam-timezone-aware date helpers.
//
// The previous version of this app used `new Date()` and `.toDateString()`
// directly, which means "today" was computed using whatever timezone the
// machine running the app happened to be set to. On a machine set to a
// different timezone than Vietnam, "Today" / "Tomorrow" labels and the
// weekly grouping could be off by a day. Every helper below explicitly
// pins its calculations to Asia/Ho_Chi_Minh (ICT, UTC+7, no DST) so the
// app behaves the same regardless of the host machine's local timezone.

export const VN_TZ = 'Asia/Ho_Chi_Minh'

// Returns 'YYYY-MM-DD' for "right now" in Vietnam time.
export function vnTodayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

// Returns 'HH:MM' for "right now" in Vietnam time (24h).
export function vnNowTimeStr() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
}

// Parses a 'YYYY-MM-DD' string into a plain {y,m,d} object (no Date/timezone
// math involved), so date-only comparisons never drift across timezones.
export function parseDateStr(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  return { y, m, d }
}

// Days between two 'YYYY-MM-DD' strings (b - a).
export function daysBetween(aStr, bStr) {
  const a = parseDateStr(aStr)
  const b = parseDateStr(bStr)
  if (!a || !b) return null
  const aUTC = Date.UTC(a.y, a.m - 1, a.d)
  const bUTC = Date.UTC(b.y, b.m - 1, b.d)
  return Math.round((bUTC - aUTC) / 86400000)
}

// ISO weekday for a 'YYYY-MM-DD' string: 1 = Monday ... 7 = Sunday.
export function isoWeekday(dateStr) {
  const d = parseDateStr(dateStr)
  if (!d) return null
  const jsDay = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay
}

// Adds `n` days to a 'YYYY-MM-DD' string, returns 'YYYY-MM-DD'.
export function addDaysStr(dateStr, n) {
  const d = parseDateStr(dateStr)
  const dt = new Date(Date.UTC(d.y, d.m - 1, d.d))
  dt.setUTCDate(dt.getUTCDate() + n)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Returns the 7 'YYYY-MM-DD' strings (Monday..Sunday) for the week
// containing "today" in Vietnam time.
export function currentWeekDatesVN() {
  const today = vnTodayStr()
  const wd = isoWeekday(today) // 1..7
  const monday = addDaysStr(today, -(wd - 1))
  return Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i))
}

const VN_WEEKDAY_LABELS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']

// Full Vietnamese label for a date, e.g. "Hôm nay", "Ngày mai", or
// "Thứ Tư, 29/07".
export function vnDayLabel(dateStr) {
  if (!parseDateStr(dateStr)) return 'Ngày không hợp lệ'
  const today = vnTodayStr()
  const diff = daysBetween(today, dateStr)
  if (diff === 0) return 'Hôm nay'
  if (diff === 1) return 'Ngày mai'
  if (diff === -1) return 'Hôm qua'
  const wd = isoWeekday(dateStr)
  const { m, d } = parseDateStr(dateStr)
  return `${VN_WEEKDAY_LABELS[wd - 1]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

// Short weekday label used with a separate "Hôm nay" badge in the section header.
export function vnWeekdayHeader(dateStr) {
  const wd = isoWeekday(dateStr)
  const { m, d } = parseDateStr(dateStr)
  return `${VN_WEEKDAY_LABELS[wd - 1]} · ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

// Adds `n` months to a 'YYYY-MM-DD' string, clamping the day if the
// target month is shorter (e.g. Jan 31 + 1 month -> Feb 28/29).
export function addMonthsStr(dateStr, n) {
  const d = parseDateStr(dateStr)
  const totalMonths = (d.m - 1) + n
  const targetYear = d.y + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12 // 0-indexed, always positive
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(d.d, daysInTargetMonth)
  const y = targetYear
  const m = String(targetMonth + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Adds `n` years, clamping Feb 29 -> Feb 28 on non-leap target years.
export function addYearsStr(dateStr, n) {
  return addMonthsStr(dateStr, n * 12)
}

function monthSerial(date) {
  return date.y * 12 + date.m - 1
}

function anchoredMonthOccurrence(dateStr, anchorStr, intervalMonths) {
  const current = parseDateStr(dateStr)
  const anchor = parseDateStr(anchorStr)
  if (!current || !anchor || intervalMonths <= 0) return null

  const elapsedMonths = monthSerial(current) - monthSerial(anchor)
  const occurrence = Math.max(0, Math.floor(elapsedMonths / intervalMonths) + 1)
  return addMonthsStr(anchorStr, occurrence * intervalMonths)
}

// Given a due date and a recurrence interval key, returns the next
// occurrence's due date. Used when a recurring task is marked complete.
export function nextOccurrenceDate(dateStr, interval, anchorDate = dateStr) {
  if (!parseDateStr(dateStr)) return null
  switch (interval) {
    case 'daily': return addDaysStr(dateStr, 1)
    case 'weekly': return addDaysStr(dateStr, 7)
    case 'monthly': return anchoredMonthOccurrence(dateStr, anchorDate, 1) || addMonthsStr(dateStr, 1)
    case 'quarterly': return anchoredMonthOccurrence(dateStr, anchorDate, 3) || addMonthsStr(dateStr, 3)
    case 'yearly': return anchoredMonthOccurrence(dateStr, anchorDate, 12) || addYearsStr(dateStr, 1)
    default: return null
  }
}

export const RECURRENCE_LABELS = {
  none: 'Không lặp lại',
  daily: 'Hằng ngày',
  weekly: 'Hằng tuần',
  monthly: 'Hằng tháng',
  quarterly: 'Hằng quý',
  yearly: 'Hằng năm'
}

// Older tasks may have a plain boolean `recurring: true` from before this
// was a dropdown. Normalize any shape to one of the valid interval keys.
export function normalizeRecurring(value) {
  if (value === true) return 'daily'
  if (typeof value === 'string' && RECURRENCE_LABELS[value]) return value
  return 'none'
}

export function formatTimeVN(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'CH' : 'SA'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}
