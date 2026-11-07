import { describe, expect, it } from 'vitest'
import { tagColorFor } from './tagColor'

describe('tagColorFor', () => {
  it('assigns a consistent palette color for a tag label', () => {
    expect(tagColorFor('Hợp đồng')).toBe(tagColorFor('Hợp đồng'))
    expect(['rose', 'emerald', 'blue', 'amber']).toContain(tagColorFor('Hợp đồng'))
  })

  it('keeps an existing explicit palette color', () => {
    expect(tagColorFor('Họp ban', 'blue')).toBe('blue')
  })

  it('replaces the gray default with a palette color', () => {
    expect(['rose', 'emerald', 'blue', 'amber']).toContain(tagColorFor('Tài chính', 'gray'))
  })
})
