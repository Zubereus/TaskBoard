import { describe, expect, it } from 'vitest'
import positionModule from './popup-position.js'

const { positionNearAnchor, cornerPosition } = positionModule

const SIZE = { width: 360, height: 440 }
const BOUNDS = { x: 0, y: 0, width: 1920, height: 1080 }
const fits = (pos, workArea) =>
  pos.x >= workArea.x && pos.y >= workArea.y &&
  pos.x + SIZE.width <= workArea.x + workArea.width &&
  pos.y + SIZE.height <= workArea.y + workArea.height

describe('flyout placement', () => {
  it('opens above a bottom taskbar, centred on the icon', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const pos = positionNearAnchor({ anchor: { x: 1500, y: 1050, width: 16, height: 24 }, size: SIZE, bounds: BOUNDS, workArea })
    expect(pos).toEqual({ x: 1328, y: 1040 - 440 - 8 })
  })

  it('keeps the window on screen when the icon is at the far right', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const pos = positionNearAnchor({ anchor: { x: 1900, y: 1050, width: 16, height: 24 }, size: SIZE, bounds: BOUNDS, workArea })
    expect(pos.x).toBe(1920 - 360 - 8)
    expect(fits(pos, workArea)).toBe(true)
  })

  it('opens below a top taskbar', () => {
    const workArea = { x: 0, y: 40, width: 1920, height: 1040 }
    const pos = positionNearAnchor({ anchor: { x: 1500, y: 8, width: 16, height: 24 }, size: SIZE, bounds: BOUNDS, workArea })
    expect(pos.y).toBe(48)
  })

  it('opens beside a left or right taskbar', () => {
    const right = { x: 0, y: 0, width: 1860, height: 1080 }
    expect(
      positionNearAnchor({ anchor: { x: 1880, y: 500, width: 24, height: 16 }, size: SIZE, bounds: BOUNDS, workArea: right })
    ).toEqual({ x: 1860 - 360 - 8, y: 288 })
    const left = { x: 60, y: 0, width: 1860, height: 1080 }
    expect(
      positionNearAnchor({ anchor: { x: 20, y: 500, width: 24, height: 16 }, size: SIZE, bounds: BOUNDS, workArea: left })
    ).toEqual({ x: 68, y: 288 })
  })

  it('falls back to a point anchor (no icon bounds) and stays inside the work area', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const pos = positionNearAnchor({ anchor: { x: 1910, y: 1075, width: 0, height: 0 }, size: SIZE, bounds: BOUNDS, workArea })
    expect(fits(pos, workArea)).toBe(true)
  })

  it('works on a second monitor with a negative origin', () => {
    const bounds = { x: -1920, y: 0, width: 1920, height: 1080 }
    const workArea = { x: -1920, y: 0, width: 1920, height: 1040 }
    const pos = positionNearAnchor({ anchor: { x: -300, y: 1050, width: 16, height: 24 }, size: SIZE, bounds, workArea })
    expect(fits(pos, workArea)).toBe(true)
  })
})

describe('corner widget placement', () => {
  it('sits in the bottom-right corner of the usable area', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(cornerPosition({ size: { width: 340, height: 196 }, workArea })).toEqual({ x: 1564, y: 828 })
  })
})
