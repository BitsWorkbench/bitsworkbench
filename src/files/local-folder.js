/**
 * A folder on the student's own computer, through the File System Access
 * API (Chrome, Edge and ChromeOS). The folder's handle is kept in IndexedDB,
 * so after a reload the folder comes back with one click to allow it again.
 * The FileStore methods are described in store.js.
 */

import { byKindThenName, taken } from './browser-store.js'

const DB = 'opencodebot-files'
const TEMP = '.renaming-' // a case-only rename's hidden copy, while it lasts
const STORE = 'handles'
const KEY = 'folder'

export class LocalFolderStore {
  static supported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  }

  constructor() {
    this.kind = 'folder'
    this.root = null
    this.name = null
  }

  async remembered() {
    const handle = await idb('readonly', (s) => s.get(KEY)).catch(() => null)
    return handle?.name ?? null
  }

  async pickFolder() {
    let handle
    try {
      handle = await window.showDirectoryPicker({ id: 'opencodebot', mode: 'readwrite' })
    } catch {
      return null // the student cancelled
    }
    if (!(await allowed(handle, true))) return null
    await idb('readwrite', (s) => s.put(handle, KEY)).catch(() => {})
    return this._use(handle)
  }

  async reopen() {
    const handle = await idb('readonly', (s) => s.get(KEY)).catch(() => null)
    if (!handle || !(await allowed(handle, true))) return null
    return this._use(handle)
  }

  async _use(handle) {
    this.root = handle
    this.name = handle.name
    await this._recover().catch(() => {})
    return this.name
  }

  async list(dir = '') {
    const folder = await this._dir(dir)
    const out = []
    for await (const [name, entry] of folder.entries()) {
      if (name.startsWith('.')) continue // hidden files and folders
      out.push({ name, path: dir ? `${dir}/${name}` : name, kind: entry.kind === 'directory' ? 'dir' : 'file' })
    }
    return out.sort(byKindThenName)
  }

  async mkdir(path) {
    await this._writable()
    await this._dir(path, true)
  }

  /** Remove a file, or a folder and all in it. */
  async remove(path) {
    await this._writable()
    const parts = path.split('/')
    const name = parts.pop()
    await (await this._dir(parts.join('/'))).removeEntry(name, { recursive: true })
  }

  /**
   * Rename (or move) a file or a folder: a copy, then the old one removed, so
   * it works for both everywhere. Many computers' folders ignore case, so a
   * name differing only in case is taken, and a rename that only changes case
   * (main.py to Main.py) goes through a temporary name: a copy onto itself,
   * then removing "the old one", would delete it.
   */
  async rename(from, to) {
    await this._writable()
    const entry = await this._entry(from)
    if (!entry) throw new Error(`${from}: not found`)
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    if (!caseOnly && (await this._entry(to, true))) throw taken(to)
    if (caseOnly) {
      const parts = from.split('/')
      const temp = [...parts.slice(0, -1), `${TEMP}${Date.now()}-${parts.at(-1)}`].join('/')
      await this._copy(entry, temp)
      await this.remove(from)
      try {
        await this._copy(await this._entry(temp), to)
      } catch (err) {
        // The new name could not be written: put it back as it was. If even
        // that fails, the hidden copy is found and restored when the folder
        // is next opened (_recover).
        await this.remove(to).catch(() => {})
        await this._copy(await this._entry(temp), from)
        await this.remove(temp)
        throw err
      }
      await this.remove(temp)
      return
    }
    await this._copy(entry, to)
    await this.remove(from)
  }

  /**
   * A rename cut short (the page closed, the disk full) can leave its hidden
   * copy, the only one: put each back under its own name, or, if that name is
   * in use, beside it as name-recovered. Nothing is thrown away.
   */
  async _recover(dir = '') {
    const folder = await this._dir(dir)
    const found = []
    for await (const [name, entry] of folder.entries()) {
      const m = name.match(/^\.renaming-\d+-(.+)$/)
      if (m) found.push([name, m[1]])
      else if (entry.kind === 'directory' && !name.startsWith('.')) await this._recover(dir ? `${dir}/${name}` : name)
    }
    for (const [temp, original] of found) {
      const at = (n) => (dir ? `${dir}/${n}` : n)
      let name = original
      for (let i = 1; await this._entry(at(name), true); i++) {
        const [, stem, ext = ''] = original.match(/^(.*?)(\.[^.]*)?$/)
        name = `${stem}-recovered${i > 1 ? `-${i}` : ''}${ext}`
      }
      await this._copy(await this._entry(at(temp)), at(name))
      await this.remove(at(temp))
    }
  }

  async _copy(entry, to) {
    if (entry.kind === 'file') {
      const out = await (await this._file(to, true)).createWritable()
      await out.write(await entry.getFile())
      await out.close()
      return
    }
    await this._dir(to, true)
    for await (const [name, child] of entry.entries()) await this._copy(child, `${to}/${name}`)
  }

  /** The file or folder at `path`, or null; `anyCase`: one whose name differs only in case counts. */
  async _entry(path, anyCase = false) {
    const parts = path.split('/')
    const name = parts.pop()
    let dir
    try {
      dir = await this._dir(parts.join('/'))
    } catch {
      return null
    }
    const same = anyCase ? (n) => n.toLowerCase() === name.toLowerCase() : (n) => n === name
    for await (const [n, e] of dir.entries()) if (same(n)) return e
    return null
  }

  async _writable() {
    if (!(await allowed(this.root, true))) throw new Error('not allowed')
  }

  async read(path) {
    const file = await (await this._file(path)).getFile()
    return file.text()
  }

  async write(path, text) {
    if (!(await allowed(this.root, true))) throw new Error('not allowed')
    const handle = await this._file(path, true)
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  /** Whether a file or folder is there, in any case: on many computers Main.py would be main.py. */
  async exists(path) {
    return !!(await this._entry(path, true))
  }

  async _dir(path, create = false) {
    if (!this.root) throw new Error('no folder')
    let dir = this.root
    for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
    return dir
  }

  async _file(path, create = false) {
    const parts = path.split('/')
    const name = parts.pop()
    return (await this._dir(parts.join('/'), create)).getFileHandle(name, { create })
  }
}

/** Whether the folder may be read and written, asking the student if it needs to (only from a click). */
async function allowed(handle, ask) {
  if (!handle.queryPermission) return true // a handle with no permissions to ask for
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return ask && (await handle.requestPermission(opts)) === 'granted'
}

/** One IndexedDB request on the handles store. */
function idb(mode, request) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(STORE, mode)
      const req = request(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => db.close()
    }
  })
}
