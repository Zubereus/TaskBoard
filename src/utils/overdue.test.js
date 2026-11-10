import { describe, expect, it } from 'vitest'
import { formatOverdueAge } from './overdue'

describe('formatOverdueAge', () => {
  it('uses minutes, hours, then days', () => {
    expect(formatOverdueAge(0)).toBe('vừa quá hạn')
    expect(formatOverdueAge(45)).toBe('quá hạn 45 phút')
    expect(formatOverdueAge(60)).toBe('quá hạn 1 giờ')
    expect(formatOverdueAge(23 * 60 + 59)).toBe('quá hạn 23 giờ')
    expect(formatOverdueAge(48 * 60)).toBe('quá hạn 2 ngày')
  })

  it('treats bad input as just overdue', () => {
    expect(formatOverdueAge(-5)).toBe('vừa quá hạn')
    expect(formatOverdueAge(undefined)).toBe('vừa quá hạn')
  })
})
