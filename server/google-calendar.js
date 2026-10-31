const { google } = require('googleapis')
const http = require('http')
const { URL } = require('url')

// 'calendar.events' lets us create/update/delete events (what actually
// matters for syncing tasks). 'calendar.calendarlist.readonly' is a
// separate, narrower read-only scope needed just so Settings can show a
// dropdown of which of the user's calendars to sync into — without it,
// calendarList.list() fails with a 403 "insufficient_scope" error even
// though event sync itself would still work fine.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
]

// Same Vietnam-timezone anchor used everywhere else in the app (see
// src/utils/vnDate.js). A task's dueDate/dueTime are wall-clock values
// meant in Vietnam time, so we tell Google's API that explicitly via
// `timeZone` rather than relying on a UTC offset or the host machine's
// system timezone.
const VN_TZ = 'Asia/Ho_Chi_Minh'

/**
 * Runs Google's "installed app" OAuth flow using a one-time local loopback
 * server (http://127.0.0.1:<random free port>) to catch the redirect.
 * Opens the consent screen in the user's normal default browser (not an
 * embedded webview — Google blocks those) via `openExternal`, and resolves
 * with the token set once the user approves access.
 */
function runOAuthFlow(clientId, clientSecret, openExternal) {
  return new Promise((resolve, reject) => {
    let settled = false
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const errorParam = url.searchParams.get('error')

        if (errorParam) {
          res.end('Google sign-in was cancelled. You can close this tab.')
          finish(new Error(`Đã hủy đăng nhập Google (${errorParam}).`))
          return
        }
        if (!code) {
          res.end('Missing authorization code.')
          return
        }

        res.end('Google Calendar connected — you can close this tab and return to TaskBoard.')
        const port = server.address().port
        const redirectUri = `http://127.0.0.1:${port}`
        const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
        const { tokens } = await oAuth2Client.getToken(code)
        finish(null, tokens)
      } catch (err) {
        finish(err)
      }
    })

    function finish(err, tokens) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      if (err) reject(err)
      else resolve(tokens)
    }

    const timeout = setTimeout(() => {
      finish(new Error('Hết thời gian chờ đăng nhập Google.'))
    }, 5 * 60 * 1000)

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const redirectUri = `http://127.0.0.1:${port}`
      const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      })
      openExternal(authUrl)
    })

    server.on('error', (err) => finish(err))
  })
}

function clientFromTokens(clientId, clientSecret, tokens) {
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret)
  oAuth2Client.setCredentials(tokens)
  return oAuth2Client
}

async function listCalendars(auth) {
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.calendarList.list()
  return (res.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary
  }))
}

function taskToEvent(task) {
  const descriptionParts = []
  if (task.notes) descriptionParts.push(task.notes)
  if (task.tags && task.tags.length) {
    descriptionParts.push(`Tags: ${task.tags.map((t) => t.text).join(', ')}`)
  }
  const description = descriptionParts.join('\n')

  if (task.dueTime) {
    const end = addOneHour(task.dueDate, task.dueTime)
    return {
      summary: task.title,
      description,
      start: { dateTime: `${task.dueDate}T${task.dueTime}:00`, timeZone: VN_TZ },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone: VN_TZ }
    }
  }
  return {
    summary: task.title,
    description,
    start: { date: task.dueDate },
    // Google Calendar uses an exclusive end date for all-day events.
    end: { date: addDays(task.dueDate, 1) }
  }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

// Adds one hour to a 'YYYY-MM-DD' + 'HH:MM' pair using plain calendar
// arithmetic (Date.UTC as a pure calendar calculator, never read back
// through a local-timezone accessor) — so this never depends on, or is
// skewed by, the host machine's system timezone.
function addOneHour(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, h + 1, min))
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`
  }
}

async function upsertEvent(auth, calendarId, task, existingEventId) {
  const calendar = google.calendar({ version: 'v3', auth })
  const requestBody = taskToEvent(task)
  if (existingEventId) {
    try {
      const res = await calendar.events.update({ calendarId, eventId: existingEventId, requestBody })
      return res.data
    } catch (err) {
      // Event may have been deleted on the Google Calendar side — fall
      // through and create a fresh one instead of failing the save.
      if (err.code !== 404 && err.code !== 410) throw err
    }
  }
  const res = await calendar.events.insert({ calendarId, requestBody })
  return res.data
}

async function deleteEvent(auth, calendarId, eventId) {
  if (!eventId) return
  const calendar = google.calendar({ version: 'v3', auth })
  try {
    await calendar.events.delete({ calendarId, eventId })
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err
  }
}

module.exports = { runOAuthFlow, clientFromTokens, listCalendars, upsertEvent, deleteEvent }
