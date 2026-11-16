/**
 * Files kept in this browser's own storage (IndexedDB), on this computer
 * only and never uploaded. Every browser has it, so a student always has a
 * real file to work in, with or without a folder on the computer. (IndexedDB
 * rather than the browser's private file system: Safari cannot write files
 * there from a page.) The FileStore methods are described in store.js.
 */

const DB = 'opencodebot-browser-files'
const STORE = 'entries' // { path, kind: 'file' | 'dir', text? }

export class BrowserStore {
  constructor() {
    this.kind = 'browser'
    // Always open: the name the app shows is its own words for "this browser".
    this.name = 'browser'
  }

  async list(dir = '') {
    const prefix = dir ? `${dir}/` : ''
    const all = await tx('readonly', (s) => s.getAll())
    const out = []
    for (const e of all) {
      if (!e.path.startsWith(prefix)) continue
      const name = e.path.slice(prefix.length)
      if (!name || name.includes('/')) continue
      out.push({ name, path: e.path, kind: e.kind })
    }
    return out.sort(byKindThenName)
  }

  async read(path) {
    const e = await tx('readonly', (s) => s.get(path))
    if (!e || e.kind !== 'file') throw new Error(`${path}: not found`)
    return e.text
  }

  async write(path, text) {
    await this._parents(path)
    await tx('readwrite', (s) => s.put({ path, kind: 'file', text }))
  }

  async exists(path) {
    return !!(await tx('readonly', (s) => s.get(path)))
  }

  async mkdir(path) {
    await this._parents(path)
    if (!(await this.exists(path))) await tx('readwrite', (s) => s.put({ path, kind: 'dir' }))
  }

  /** Remove a file, or a folder and all in it. */
  async remove(path) {
    const all = await tx('readonly', (s) => s.getAllKeys())
    const gone = all.filter((p) => p === path || p.startsWith(`${path}/`))
    await tx('readwrite', (s) => {
      let last
      for (const p of gone) last = s.delete(p)
      return last ?? s.count()
    })
  }

  /** Rename (or move) a file or a folder, with all in it. */
  async rename(from, to) {
    if (await this.exists(to)) throw taken(to)
    await this._parents(to)
    const all = await tx('readonly', (s) => s.getAll())
    const moved = all.filter((e) => e.path === from || e.path.startsWith(`${from}/`))
    await tx('readwrite', (s) => {
      let last
      for (const e of moved) {
        s.delete(e.path)
        last = s.put({ ...e, path: to + e.path.slice(from.length) })
      }
      return last ?? s.count()
    })
  }

  async _parents(path) {
    const parts = path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      if (!(await this.exists(p))) await tx('readwrite', (s) => s.put({ path: p, kind: 'dir' }))
    }
  }
}

/** The error a rename gives when the new name is in use (`taken` tells it from a failure). */
export function taken(path) {
  return Object.assign(new Error(`${path}: already there`), { taken: true })
}

export function byKindThenName(a, b) {
  return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
}

/** One transaction on the entries store; resolves with the last request's result once it commits. */
function tx(mode, request) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'path' })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const t = db.transaction(STORE, mode)
      const req = request(t.objectStore(STORE))
      t.oncomplete = () => {
        db.close()
        resolve(req.result)
      }
      t.onerror = () => {
        db.close()
        reject(t.error)
      }
    }
  })
}
