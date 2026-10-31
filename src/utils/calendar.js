import { addDaysStr, isoWeekday } from './vnDate'

export function calendarMonthDays(monthDate, selectedDate = '', todayDate = '') {
  const firstDay = `${monthDate.slice(0, 7)}-01`
  const mondayOffset = isoWeekday(firstDay) - 1

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDaysStr(firstDay, index - mondayOffset)
    return {
      date,
      day: Number(date.slice(-2)),
      inMonth: date.slice(0, 7) === monthDate.slice(0, 7),
      isToday: date === todayDate,
      isSelected: date === selectedDate
    }
  })
}
