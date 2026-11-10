// Owns the two small helper windows:
//  - the tray flyout: opens on a tray click, closes when it loses focus
//  - the corner widget: appears by itself, never takes keyboard focus
// Both render the same Vue app (src/PopupApp.vue) selected by the URL hash and
// are fed by `push(payload)`.

const { positionNearAnchor, cornerPosition } = require('../server/popup-position')

const FLYOUT_SIZE = { width: 360, height: 440 }
const WIDGET_SIZE = { width: 340, height: 200 }
// A tray click that closes the flyout through its blur event would otherwise
// reopen it straight away when the click itself is delivered.
const REOPEN_GUARD_MS = 300

function createPopups({ BrowserWindow, screen, preload, loadView, getTrayAnchor, iconPath }) {
  let flyout = null
  let widget = null
  let flyoutHiddenAt = 0

  const alive = (win) => Boolean(win) && !win.isDestroyed()

  function create(view, size, extra) {
    const win = new BrowserWindow({
      ...size,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: '#FFFFFF',
      icon: iconPath,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
      ...extra
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    loadView(win, view)
    return win
  }

  function whenLoaded(win, callback) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', callback)
    else callback()
  }

  function ensureFlyout() {
    if (alive(flyout)) return flyout
    flyout = create('flyout', FLYOUT_SIZE, { alwaysOnTop: true })
    flyout.on('blur', hideFlyout)
    flyout.on('closed', () => {
      flyout = null
    })
    return flyout
  }

  function hideFlyout() {
    if (!alive(flyout) || !flyout.isVisible()) return
    flyout.hide()
    flyoutHiddenAt = Date.now()
  }

  function toggleFlyout() {
    const win = ensureFlyout()
    if (win.isVisible()) {
      hideFlyout()
      return
    }
    if (Date.now() - flyoutHiddenAt < REOPEN_GUARD_MS) return
    const anchor = getTrayAnchor()
    const display = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) })
    const { x, y } = positionNearAnchor({
      anchor,
      size: FLYOUT_SIZE,
      bounds: display.bounds,
      workArea: display.workArea
    })
    win.setPosition(x, y, false)
    // The flyout takes focus on purpose: losing it is what closes the window.
    whenLoaded(win, () => {
      win.show()
      win.focus()
    })
  }

  function setWidgetVisible(visible) {
    if (!visible) {
      if (alive(widget) && widget.isVisible()) widget.hide()
      return
    }
    if (!alive(widget)) {
      // focusable:false keeps clicks working but never pulls focus from the
      // app the person is typing in.
      widget = create('widget', WIDGET_SIZE, { focusable: false })
      widget.on('closed', () => {
        widget = null
      })
    }
    if (widget.isVisible()) return
    const { x, y } = cornerPosition({ size: WIDGET_SIZE, workArea: screen.getPrimaryDisplay().workArea })
    widget.setPosition(x, y, false)
    const target = widget
    // showInactive puts it on top once, without activating it; it is not pinned
    // always-on-top, so other windows can cover it afterwards.
    whenLoaded(target, () => {
      if (alive(target)) target.showInactive()
    })
  }

  function push(payload) {
    ;[flyout, widget]
      .filter(alive)
      .forEach((win) => win.webContents.send('agenda:changed', payload))
  }

  // Create the flyout hidden at startup so the first tray click has no load delay.
  function warmUp() {
    ensureFlyout()
  }

  return { toggleFlyout, hideFlyout, setWidgetVisible, push, warmUp }
}

module.exports = { createPopups, FLYOUT_SIZE, WIDGET_SIZE }
