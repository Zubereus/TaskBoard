import { describe, expect, it } from 'vitest'
import { dateInputCaretPosition, displayToIso, formatDateInput } from './dateInput'

describe('date input formatting', () => {
  it('pads single-digit day and month in slash-separated dates', () => {
    expect(formatDateInput('1/11/2026')).toEqual({
      text: '01/11/2026',
      iso: '2026-11-01',
      invalid: false
    })
  })

  it('keeps auto-inserting slashes for digit-only input', () => {
    expect(formatDateInput('01112026')).toEqual({
      text: '01/11/2026',
      iso: '2026-11-01',
      invalid: false
    })
  })

  it('continues digit-only typing after auto-inserting each separator', () => {
    let text = ''
    for (const digit of '01112026') {
      text = formatDateInput(text + digit).text
    }

    expect(text).toBe('01/11/2026')
    expect(formatDateInput(text).iso).toBe('2026-11-01')
  })

  it('places the caret after an automatically inserted separator', () => {
    expect(dateInputCaretPosition('01/11/', 4)).toBe(6)
  })

  it('keeps partial input editable and flags invalid complete dates', () => {
    expect(formatDateInput('1/11/')).toMatchObject({
      text: '1/11/',
      iso: null,
      invalid: false
    })
    expect(formatDateInput('31/02/2026')).toMatchObject({
      text: '31/02/2026',
      iso: null,
      invalid: true
    })
  })

  it('parses one-digit day and month values', () => {
    expect(displayToIso('1/1/2026')).toBe('2026-01-01')
  })
})
