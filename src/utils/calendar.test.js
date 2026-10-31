import { describe, expect, it } from 'vitest'
import { calendarMonthDays } from './calendar'

describe('calendar month grid', () => {
  it('starts on Monday and includes adjacent month dates', () => {
    const days = calendarMonthDays('2026-11-01')

    expect(days).toHaveLength(42)
    expect(days[0].date).toBe('2026-10-26')
    expect(days[0].inMonth).toBe(false)
    expect(days.find((day) => day.date === '2026-11-01').inMonth).toBe(true)
    expect(days.at(-1).date).toBe('2026-12-06')
  })

  it('marks today and the selected date without changing their date values', () => {
    const days = calendarMonthDays('2026-02-01', '2026-02-28', '2026-02-28')
    const selected = days.find((day) => day.date === '2026-02-28')

    expect(selected).toMatchObject({
      date: '2026-02-28',
      day: 28,
      inMonth: true,
      isToday: true,
      isSelected: true
    })
  })

  it('handles leap February and a month beginning on Sunday', () => {
    const leapFebruary = calendarMonthDays('2024-02-01')
    const sundayStart = calendarMonthDays('2026-03-01')

    expect(leapFebruary.filter((day) => day.inMonth)).toHaveLength(29)
    expect(sundayStart[0].date).toBe('2026-02-23')
    expect(sundayStart.findIndex((day) => day.date === '2026-03-01')).toBe(6)
  })
})
