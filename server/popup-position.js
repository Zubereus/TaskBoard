// Screen-placement maths for the tray flyout and the corner widget. Pure, so it
// can be tested without a display.

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

// Opens next to the tray icon. The taskbar edge is the display edge closest to
// the icon, so the window hugs that side of the usable work area and is centred
// on the icon along the other axis, kept fully on screen.
function positionNearAnchor({ anchor, size, bounds, workArea, gap = 8 }) {
  const centerX = anchor.x + (anchor.width || 0) / 2
  const centerY = anchor.y + (anchor.height || 0) / 2
  const [edge] = [
    ['top', centerY - bounds.y],
    ['bottom', bounds.y + bounds.height - centerY],
    ['left', centerX - bounds.x],
    ['right', bounds.x + bounds.width - centerX]
  ].reduce((best, current) => (current[1] < best[1] ? current : best))

  const x = clamp(
    Math.round(centerX - size.width / 2),
    workArea.x + gap,
    workArea.x + workArea.width - size.width - gap
  )
  const y = clamp(
    Math.round(centerY - size.height / 2),
    workArea.y + gap,
    workArea.y + workArea.height - size.height - gap
  )

  switch (edge) {
    case 'top':
      return { x, y: workArea.y + gap }
    case 'left':
      return { x: workArea.x + gap, y }
    case 'right':
      return { x: workArea.x + workArea.width - size.width - gap, y }
    default:
      return { x, y: workArea.y + workArea.height - size.height - gap }
  }
}

// Bottom-right corner of the usable area (above the taskbar).
function cornerPosition({ size, workArea, margin = 16 }) {
  return {
    x: workArea.x + workArea.width - size.width - margin,
    y: workArea.y + workArea.height - size.height - margin
  }
}

module.exports = { positionNearAnchor, cornerPosition }
