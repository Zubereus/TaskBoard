const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Footer,
  Tab,
  PageNumber,
  AlignmentType,
  BorderStyle,
  ShadingType,
  TabStopType,
  TableLayoutType,
  VerticalAlign,
  WidthType,
  HeightRule
} = require('docx')

const FONT = 'Calibri'
const PAGE = { width: 11906, height: 16838 }
const MARGIN = { top: 850, bottom: 850, left: 850, right: 850 }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right

const C = {
  navy: '1F3A5F',
  accent: '2F6DB8',
  ink: '1D2939',
  muted: '667085',
  faint: '98A2B3',
  hair: 'E4E7EC',
  panel: 'F3F6FA',
  red: 'B42318',
  redTint: 'FEF3F2',
  amber: '9A6700',
  blue: '175CD3',
  white: 'FFFFFF'
}

const COLS = { tick: 850, task: 4490, priority: 1250, assignee: 1700, due: 1916 }
const COL_LIST = [COLS.tick, COLS.task, COLS.priority, COLS.assignee, COLS.due]
const ASSIGNEE_COLS = { task: 6300, status: 1700, due: 2206 }
const ASSIGNEE_COL_LIST = [ASSIGNEE_COLS.task, ASSIGNEE_COLS.status, ASSIGNEE_COLS.due]

const TONES = {
  overdue: { bar: C.red, fill: C.redTint, text: C.red },
  today: { bar: C.accent, fill: C.panel, text: C.navy },
  normal: { bar: '98A2B3', fill: C.panel, text: C.navy }
}

const LEVELS = {
  high: { label: 'Cao', color: C.red, bold: true },
  mid: { label: 'Trung bình', color: C.amber, bold: true },
  low: { label: 'Thấp', color: C.blue, bold: false }
}

const NONE = { style: BorderStyle.NONE, size: 0, color: C.white }
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE }
const line = (color, size = 4) => ({ style: BorderStyle.SINGLE, size, color })

function run(text, options = {}) {
  return new TextRun({ text, font: FONT, color: C.ink, size: 20, ...options })
}

function para(children, options = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...options })
}

function rightTabbed(left, right) {
  return [...left, new TextRun({ children: [new Tab(), right.text], font: FONT, ...right.style })]
}

function headerBlock({ title, dateLabel, subtitle }) {
  return [
    para(run('TASKBOARD', { size: 16, bold: true, color: C.accent, characterSpacing: 60 }), { spacing: { after: 20 } }),
    para(
      rightTabbed([run(title, { size: 50, bold: true, color: C.navy })], {
        text: dateLabel,
        style: { size: 22, bold: true, color: C.muted }
      }),
      { tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }], spacing: { after: 30 } }
    ),
    para(run(subtitle, { size: 18, color: C.muted }), {
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.navy, space: 8 } }
    })
  ]
}

function kpiTable(kpis) {
  const width = Math.floor(CONTENT_WIDTH / kpis.length)
  const cells = kpis.map((k, index) => {
    const widthValue = index === kpis.length - 1 ? CONTENT_WIDTH - width * (kpis.length - 1) : width
    const color = k.tone === 'alert' && k.value > 0 ? C.red : C.navy
    return new TableCell({
      width: { size: widthValue, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: C.panel, color: 'auto' },
      margins: { top: 110, bottom: 110, left: 200, right: 120 },
      borders: {
        top: line(color, 18),
        bottom: NONE,
        left: index === 0 ? NONE : { style: BorderStyle.SINGLE, size: 24, color: C.white },
        right: NONE
      },
      children: [
        para(run(k.label.toUpperCase(), { size: 15, bold: true, color: C.muted, characterSpacing: 20 }), { spacing: { after: 20 } }),
        para(run(String(k.value), { size: 40, bold: true, color }))
      ]
    })
  })
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: kpis.map((_, index) => index === kpis.length - 1 ? CONTENT_WIDTH - width * (kpis.length - 1) : width),
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: cells })]
  })
}

function sectionBar(section) {
  const tone = TONES[section.tone] || TONES.normal
  return para(
    rightTabbed([run(section.title.toUpperCase(), { size: 19, bold: true, color: tone.text, characterSpacing: 10 })], {
      text: `${section.items.length} việc`,
      style: { size: 17, color: C.muted }
    }),
    {
      keepNext: true,
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH - 120 }],
      spacing: { before: 300, after: 0 },
      shading: { type: ShadingType.CLEAR, fill: tone.fill, color: 'auto' },
      indent: { left: 120, right: 0 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: tone.bar, space: 8 } }
    }
  )
}

function headCell(text, width, align = AlignmentType.LEFT) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    borders: { ...NO_BORDERS, bottom: line(C.navy, 8) },
    children: [para(run(text, {
      size: text === 'XONG' ? 14 : 15,
      bold: true,
      color: C.muted,
      characterSpacing: text === 'XONG' ? 0 : 20
    }), { alignment: align })]
  })
}

function headRow() {
  return new TableRow({
    tableHeader: true,
    children: [
      headCell('XONG', COLS.tick, AlignmentType.CENTER),
      headCell('CÔNG VIỆC', COLS.task),
      headCell('ƯU TIÊN', COLS.priority),
      headCell('PHỤ TRÁCH', COLS.assignee),
      headCell('HẠN', COLS.due)
    ]
  })
}

function bodyCell(width, children) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    borders: { ...NO_BORDERS, bottom: line(C.hair, 4) },
    children
  })
}

function tickBox(done) {
  return para(
    new TextRun({
      text: done ? '\u2611' : '\u2610',
      font: 'Segoe UI Symbol',
      size: 32,
      color: done ? C.accent : C.navy
    }),
    { alignment: AlignmentType.CENTER }
  )
}

function itemRow(item) {
  const level = LEVELS[item.level] || LEVELS.low
  const titleParagraph = para(run(item.title || '(Không có tiêu đề)', {
    size: 23,
    bold: true,
    strike: !!item.done,
    color: item.done ? C.muted : C.ink
  }))
  const metaParagraph = item.meta
    ? [para(run(item.meta, { size: 16, color: C.muted }), { spacing: { before: 30 } })]
    : []
  const dueColor = item.dueTone === 'overdue' ? C.red : C.ink

  return new TableRow({
    cantSplit: true,
    height: { value: 600, rule: HeightRule.ATLEAST },
    children: [
      bodyCell(COLS.tick, [tickBox(item.done)]),
      bodyCell(COLS.task, [titleParagraph, ...metaParagraph]),
      bodyCell(COLS.priority, [
        para([run('\u25CF ', { size: 16, color: level.color }), run(level.label, { size: 18, bold: level.bold, color: level.color })])
      ]),
      bodyCell(COLS.assignee, [para(run(item.assignees || '\u2014', { size: 19, color: item.assignees ? C.ink : C.faint }))]),
      bodyCell(COLS.due, [
        para(run(item.due || '\u2014', {
          size: 19,
          color: item.due ? dueColor : C.faint,
          bold: item.dueTone === 'overdue' || item.dueTone === 'today'
        }))
      ])
    ]
  })
}

function sectionBlock(section) {
  return [
    sectionBar(section),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: COL_LIST,
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
      rows: [headRow(), ...section.items.map(itemRow)]
    })
  ]
}

function assigneeHeadRow() {
  return new TableRow({
    tableHeader: true,
    children: [
      headCell('CÔNG VIỆC', ASSIGNEE_COLS.task),
      headCell('TRẠNG THÁI', ASSIGNEE_COLS.status),
      headCell('HẠN', ASSIGNEE_COLS.due)
    ]
  })
}

function assigneeTaskRow(task) {
  return new TableRow({
    cantSplit: true,
    children: [
      bodyCell(ASSIGNEE_COLS.task, [
        para(run(task.title || '(Không có tiêu đề)', {
          size: 20,
          strike: task.done,
          color: task.done ? C.muted : C.ink
        }))
      ]),
      bodyCell(ASSIGNEE_COLS.status, [
        para(run(task.done ? 'Đã xong' : 'Chưa xong', {
          size: 18,
          bold: !task.done,
          color: task.done ? C.muted : C.accent
        }))
      ]),
      bodyCell(ASSIGNEE_COLS.due, [
        para(run(task.due || 'Không có hạn', {
          size: 18,
          color: task.due ? C.ink : C.faint
        }))
      ])
    ]
  })
}

function assigneeBreakdownBlock(groups) {
  const body = [
    para(run('CÔNG VIỆC THEO THÀNH VIÊN', {
      size: 19,
      bold: true,
      color: C.navy,
      characterSpacing: 10
    }), { keepNext: true, spacing: { before: 420, after: 100 } })
  ]

  if (groups.length === 0) {
    body.push(para(run('Chưa có công việc nào được giao cho thành viên trong danh sách này.', {
      size: 19,
      italics: true,
      color: C.muted
    }), { spacing: { after: 100 } }))
    return body
  }

  for (const group of groups) {
    body.push(sectionBar({
      title: group.name,
      tone: 'normal',
      items: group.tasks
    }))
    body.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: ASSIGNEE_COL_LIST,
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
      rows: [assigneeHeadRow(), ...group.tasks.map(assigneeTaskRow)]
    }))
  }

  return body
}

function notesBlock() {
  const ruledRow = () =>
    new TableRow({
      height: { value: 560, rule: HeightRule.EXACT },
      children: [
        new TableCell({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          borders: { ...NO_BORDERS, bottom: line('C9CED6', 4) },
          children: [para([])]
        })
      ]
    })

  return [
    para(run('GHI CHÚ', { size: 17, bold: true, color: C.navy, characterSpacing: 20 }), {
      keepNext: true,
      spacing: { before: 380, after: 0 }
    }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [CONTENT_WIDTH],
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
      rows: [ruledRow(), ruledRow(), ruledRow(), ruledRow()]
    })
  ]
}

function footerBlock(updatedText) {
  return new Footer({
    children: [
      para(
        [
          run(`TaskBoard  \u00B7  ${updatedText}`, { size: 16, color: C.faint }),
          new TextRun({
            children: [new Tab(), 'Trang ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
            font: FONT,
            size: 16,
            color: C.faint
          })
        ],
        {
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
          border: { top: line(C.hair, 4), space: 6 }
        }
      )
    ]
  })
}

async function renderDocument({
  title,
  dateLabel,
  subtitle,
  updatedText,
  kpis,
  sections,
  assigneeGroups = null
}) {
  const body = [...headerBlock({ title, dateLabel, subtitle }), kpiTable(kpis)]
  const filled = sections.filter((section) => section.items.length > 0)

  if (filled.length === 0) {
    body.push(para(run('Hiện không có công việc nào tồn đọng.', {
      size: 22,
      italics: true,
      color: C.muted
    }), { spacing: { before: 360, after: 120 }, alignment: AlignmentType.CENTER }))
  }

  for (const section of filled) body.push(...sectionBlock(section))
  if (assigneeGroups) body.push(...assigneeBreakdownBlock(assigneeGroups))
  body.push(...notesBlock())

  const doc = new Document({
    creator: 'TaskBoard',
    title,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 20, color: C.ink, language: { value: 'vi-VN' } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: MARGIN
          }
        },
        footers: { default: footerBlock(updatedText) },
        children: body
      }
    ]
  })

  return Packer.toBuffer(doc)
}

function kpisFrom(sections) {
  const countOf = (tone) => sections
    .filter((section) => section.tone === tone)
    .reduce((count, section) => count + section.items.length, 0)
  const total = sections.reduce((count, section) => count + section.items.length, 0)
  return [
    { label: 'Chưa xong', value: total },
    { label: 'Quá hạn', value: countOf('overdue'), tone: 'alert' },
    { label: 'Hôm nay', value: countOf('today') },
    { label: 'Chưa hẹn ngày', value: sections
      .filter((section) => section.key === 'nodate')
      .reduce((count, section) => count + section.items.length, 0) }
  ]
}

function buildTodoDocx(payload) {
  const sections = payload.sections.map((section) => ({
    key: section.key,
    title: section.title,
    tone: section.tone,
    items: section.tasks.map((task) => ({
      title: task.title,
      meta: task.meta,
      assignees: task.assignees,
      done: task.done,
      level: task.level,
      due: task.when,
      dueTone: section.tone === 'overdue' ? 'overdue' : section.tone === 'today' ? 'today' : 'normal'
    }))
  }))

  return renderDocument({
    title: 'Bảng theo dõi công việc',
    dateLabel: payload.dateLabel,
    subtitle: `${payload.scopeLabel}  \u00B7  Cập nhật ${payload.printedAt}`,
    updatedText: `Cập nhật ${payload.printedAt}`,
    kpis: kpisFrom(sections),
    sections,
    assigneeGroups: payload.assigneeGroups || null
  })
}

const VN_TZ = 'Asia/Ho_Chi_Minh'

function vnParts(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TZ,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function priorityLevel(priority) {
  return priority >= 50 ? 'high' : priority >= 10 ? 'mid' : 'low'
}

function dueText(task) {
  if (!task.dueDate) return ''
  const [year, month, day] = task.dueDate.split('-')
  return task.dueTime ? `${task.dueTime}  ${day}/${month}/${year}` : `${day}/${month}/${year}`
}

function buildAssigneeBreakdown(tasks, employees, onlyPending = true) {
  const list = onlyPending ? tasks.filter((task) => !task.done) : tasks
  return employees
    .map((employee) => ({
      name: employee.name || 'Thành viên',
      tasks: list
        .filter((task) => {
          const ids = Array.isArray(task.assigneeIds)
            ? task.assigneeIds
            : task.assigneeId
              ? [task.assigneeId]
              : []
          return ids.includes(employee.id)
        })
        .map((task) => ({
          title: task.title,
          done: !!task.done,
          due: dueText(task)
        }))
    }))
    .filter((group) => group.tasks.length > 0)
}

async function generateTasksDocx(tasks = [], employees = [], options = {}) {
  const nameOf = new Map(employees.map((employee) => [employee.id, employee.name]))
  const onlyPending = options.onlyPending !== false
  const list = onlyPending ? tasks.filter((task) => !task.done) : tasks
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())

  const byPriority = (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  const pick = (test) => list.filter(test).sort(byPriority)
  const toItem = (task) => ({
    title: task.title,
    done: task.done,
    level: priorityLevel(task.priority ?? 0),
    assignees: (task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []))
      .map((id) => nameOf.get(id))
      .filter(Boolean)
      .join(', '),
    due: dueText(task),
    dueTone: task.dueDate && task.dueDate < today && !task.done
      ? 'overdue'
      : task.dueDate === today
        ? 'today'
        : 'normal',
    meta: [
      task.tags && task.tags.length ? `Thẻ: ${task.tags.map((tag) => tag.text).join(', ')}` : '',
      task.notes ? task.notes.replace(/\s+/g, ' ').slice(0, 110) : ''
    ].filter(Boolean).join('  \u00B7  ')
  })

  const sections = [
    { key: 'overdue', title: 'Quá hạn', tone: 'overdue', items: pick((task) => task.dueDate && task.dueDate < today && !task.done).map(toItem) },
    { key: 'today', title: 'Hôm nay', tone: 'today', items: pick((task) => task.dueDate === today).map(toItem) },
    { key: 'upcoming', title: 'Sắp tới', tone: 'normal', items: pick((task) => task.dueDate && task.dueDate > today).map(toItem) },
    { key: 'nodate', title: 'Chưa hẹn ngày', tone: 'normal', items: pick((task) => !task.dueDate).map(toItem) }
  ]

  const stamp = vnParts(new Date())
  return renderDocument({
    title: 'Bảng theo dõi công việc',
    dateLabel: stamp.replace(/^\d{2}:\d{2}\s*/, ''),
    subtitle: `${options.scopeLabel || 'Tất cả thành viên'}  \u00B7  Cập nhật ${stamp}`,
    updatedText: `Cập nhật ${stamp}`,
    kpis: kpisFrom(sections),
    sections,
    assigneeGroups: options.includeAssigneeBreakdown
      ? buildAssigneeBreakdown(list, employees, false)
      : null
  })
}

module.exports = {
  buildAssigneeBreakdown,
  buildTodoDocx,
  generateTasksDocx
}
