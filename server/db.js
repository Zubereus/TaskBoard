const fs = require('fs/promises')
const path = require('path')

// On Windows an antivirus scanner or indexer can briefly hold the destination
// file open, which makes an otherwise valid rename fail with one of these.
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 6

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function renameWithRetry(from, to, attempt = 1) {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if (!TRANSIENT_RENAME_ERRORS.has(err.code) || attempt >= RENAME_ATTEMPTS) throw err
    await sleep(attempt * 15)
    return renameWithRetry(from, to, attempt + 1)
  }
}

// Simple file-backed JSON "database". Each collection is one JSON file
// living in /data. This is the bottom "File system" layer of the
// Vue -> Electron -> Node.js -> File system architecture.

class JsonCollection {
  constructor(dataDir, name) {
    this.file = path.join(dataDir, `${name}.json`)
    this._queue = Promise.resolve()
  }

  // Runs `work` once every earlier exclusive operation on this collection has
  // finished. Every write here is read-modify-write on one file, so two of them
  // running at once (several LAN events arriving together, two clients adding a
  // task at the same moment) used to overwrite each other and lose records.
  // `work` must not call insert/update/remove on this same collection.
  exclusive(work) {
    const run = this._queue.then(work)
    this._queue = run.then(() => undefined, () => undefined)
    return run
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      try {
        return JSON.parse(raw || '[]')
      } catch (parseErr) {
        throw new Error(`Tệp dữ liệu bị lỗi (${path.basename(this.file)}): ${parseErr.message}`)
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        // If someone wrote the file while we were looking, read what they wrote.
        return (await this._createIfMissing()) ? [] : this._read()
      }
      throw err
    }
  }

  // Creates an empty collection file. The 'wx' flag fails if the file already
  // exists, so this can never overwrite data that a concurrent write just saved
  // (reads are not serialised, so a read of a missing file can race a write).
  async _createIfMissing() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    try {
      await fs.writeFile(this.file, '[]', { encoding: 'utf-8', flag: 'wx' })
      return true
    } catch (err) {
      if (err.code === 'EEXIST') return false
      throw err
    }
  }

  async _write(records) {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    // A random suffix keeps two writers in the same millisecond from sharing one
    // temp file (one would rename it away and the other's rename would fail).
    const tempFile = `${this.file}.${process.pid}.${cryptoRandomId()}.tmp`
    try {
      await fs.writeFile(tempFile, JSON.stringify(records, null, 2), 'utf-8')
      await renameWithRetry(tempFile, this.file)
    } catch (err) {
      await fs.rm(tempFile, { force: true }).catch(() => undefined)
      throw err
    }
  }

  async list() {
    return this._read()
  }

  async get(id) {
    const records = await this._read()
    return records.find((r) => r.id === id) || null
  }

  insert(record) {
    return this.exclusive(async () => {
      const records = await this._read()
      const withId = { ...record, id: record.id || cryptoRandomId() }
      records.push(withId)
      await this._write(records)
      return withId
    })
  }

  update(id, patch) {
    return this.exclusive(async () => {
      const records = await this._read()
      const idx = records.findIndex((r) => r.id === id)
      if (idx === -1) return null
      records[idx] = { ...records[idx], ...patch, id }
      await this._write(records)
      return records[idx]
    })
  }

  remove(id) {
    return this.exclusive(async () => {
      const records = await this._read()
      const next = records.filter((r) => r.id !== id)
      await this._write(next)
      return records.length !== next.length
    })
  }
}

function cryptoRandomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

module.exports = { JsonCollection }