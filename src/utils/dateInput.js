export function displayToIso(display) {
  const match = display.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const [, day, month, year] = match
  const dd = Number(day)
  const mm = Number(month)
  const yyyy = Number(year)
  if (mm < 1 || mm > 12) return null
  const daysInMonth = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate()
  if (dd < 1 || dd > daysInMonth) return null
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

export function formatDateInput(value) {
  let formatted
  let digitCount

  if (value.includes('/')) {
    const [day = '', month = '', year = ''] = value
      .replace(/[^\d/]/g, '')
      .split('/')
    const parts = [
      day.replace(/\D/g, '').slice(0, 2),
      month.replace(/\D/g, '').slice(0, 2),
      year.replace(/\D/g, '').slice(0, 4)
    ]
    formatted = parts[0]
    if (value.includes('/') && parts.length > 1) {
      formatted += `/${parts[1]}`
    }
    if (value.split('/').length > 2 || parts[1].length === 2) {
      formatted += `/${parts[2]}`
    }
    digitCount = parts.join('').length
  } else {
    const digits = value.replace(/\D/g, '').slice(0, 8)
    digitCount = digits.length
    formatted = digits
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    else if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
  }

  const iso = displayToIso(formatted)
  if (iso) {
    const [year, month, day] = iso.split('-')
    return { text: `${day}/${month}/${year}`, iso, invalid: false }
  }

  return {
    text: formatted,
    iso: null,
    invalid: digitCount === 8
  }
}

export function dateInputCaretPosition(formatted, digitsBeforeCaret) {
  if (digitsBeforeCaret === 0) return 0

  let digitsSeen = 0
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) digitsSeen += 1
    if (digitsSeen === digitsBeforeCaret) {
      let caret = index + 1
      while (formatted[caret] === '/') caret += 1
      return caret
    }
  }
  return formatted.length
}
