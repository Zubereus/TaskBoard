const fs = require('fs/promises')
const path = require('path')

// Simple file-backed JSON "database". Each collection is one JSON file
// living in /data. This is the bottom "File system" layer of the
// Vue -> Electron -> Node.js -> File system architecture.

class JsonCollection {
  constructor(dataDir, name) {
    this.file = path.join(dataDir, `${name}.json`)
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
        await this._write([])
        return []
      }
      throw err
    }
  }

  async _write(records) {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tempFile = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tempFile, JSON.stringify(records, null, 2), 'utf-8')
    await fs.rename(tempFile, this.file)
  }

  async list() {
    return this._read()
  }

  async get(id) {
    const records = await this._read()
    return records.find((r) => r.id === id) || null
  }

  async insert(record) {
    const records = await this._read()
    const withId = { ...record, id: record.id || cryptoRandomId() }
    records.push(withId)
    await this._write(records)
    return withId
  }

  async update(id, patch) {
    const records = await this._read()
    const idx = records.findIndex((r) => r.id === id)
    if (idx === -1) return null
    records[idx] = { ...records[idx], ...patch, id }
    await this._write(records)
    return records[idx]
  }

  async remove(id) {
    const records = await this._read()
    const next = records.filter((r) => r.id !== id)
    await this._write(next)
    return records.length !== next.length
  }
}

function cryptoRandomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

module.exports = { JsonCollection }
