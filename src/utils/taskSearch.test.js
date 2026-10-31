import { describe, expect, it } from 'vitest'
import { matchesTaskSearch } from './taskSearch'

describe('task search', () => {
  const employees = [
    { id: 'a', name: 'Nguyễn An' },
    { id: 'b', name: 'Trần Bình' }
  ]
  const task = {
    title: 'Hoàn thiện báo cáo',
    notes: 'Gửi bản nháp cho nhóm',
    dueDate: '2026-10-30',
    dueTime: '14:30',
    tags: [{ text: 'Quan trọng' }],
    assigneeIds: ['a', 'b']
  }

  it('matches task titles, notes, tags, assignees, and formatted deadlines', () => {
    for (const query of ['báo cáo', 'bản nháp', 'quan trọng', 'nguyễn an', '30/10/2026', '14:30']) {
      expect(matchesTaskSearch(task, query, employees), query).toBe(true)
    }
  })

  it('ignores Vietnamese accents and matches every search term', () => {
    expect(matchesTaskSearch(task, 'hoan thien', employees)).toBe(true)
    expect(matchesTaskSearch(task, 'an quan trong', employees)).toBe(true)
    expect(matchesTaskSearch(task, 'báo cáo không tồn tại', employees)).toBe(false)
  })

  it('matches legacy single-assignee tasks and treats an empty query as a match', () => {
    expect(matchesTaskSearch({ title: 'Gọi khách hàng', assigneeId: 'b' }, 'tran binh', employees)).toBe(true)
    expect(matchesTaskSearch(task, '   ', employees)).toBe(true)
  })
})
