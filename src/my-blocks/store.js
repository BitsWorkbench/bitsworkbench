/**
 * "My blocks": a student's own library of grey Python blocks, saved from the
 * canvas and used again in any project. The app talks to a MyBlocksStore and
 * never to the storage under it, so another kind of storage (a signed-in
 * student's library online, say) is one more class with these methods, not
 * a change to the app. This one keeps the library in this browser only:
 * nothing is sent anywhere.
 *
 * A MyBlocksStore (an EventTarget; its methods answer at once, so the
 * palette can be drawn from them, and an online store would answer from a
 * copy it keeps):
 * - `list()`                  the saved blocks, oldest first: [{ id, name, code, value }]
 *                             (`value` is true for a piece of Python that goes in a
 *                             block's slot, false for whole lines)
 * - `add({ name, code, value })`  save a block; the saved one, or the one already
 *                             saved with that code
 * - `rename(id, name)`        give a saved block a new name
 * - `remove(id)`              take a saved block out of the library
 * - a `change` event          after any of these changes the library
 */

const STORAGE_KEY = 'opencodebot.myblocks.v1'

/** At most this many saved blocks: a library, not a second project. */
export const MAX_MY_BLOCKS = 100

/** A name from a block's code: its first line, short. */
export function nameFor(code) {
  const first = code.split('\n').find((l) => l.trim()) || ''
  const name = first.trim().replace(/\s+/g, ' ')
  return name.length > 40 ? `${name.slice(0, 39)}…` : name
}

export class LocalMyBlocksStore extends EventTarget {
  constructor(storage = globalThis.localStorage) {
    super()
    this.storage = storage
  }

  list() {
    try {
      const items = JSON.parse(this.storage?.getItem(STORAGE_KEY) || '[]')
      return Array.isArray(items) ? items.filter((i) => i && typeof i.id === 'string' && typeof i.code === 'string') : []
    } catch {
      return []
    }
  }

  add({ name, code, value = false }) {
    const items = this.list()
    const same = items.find((i) => i.code === code && !!i.value === !!value)
    if (same) return same
    if (items.length >= MAX_MY_BLOCKS) return null
    const item = { id: newId(), name: (name || nameFor(code)).trim() || nameFor(code), code, value: !!value }
    this._save([...items, item])
    return item
  }

  rename(id, name) {
    const tidy = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!tidy) return
    this._save(this.list().map((i) => (i.id === id ? { ...i, name: tidy } : i)))
  }

  remove(id) {
    this._save(this.list().filter((i) => i.id !== id))
  }

  _save(items) {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Storage full or blocked: the library stays as it was.
    }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `mb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The library for this browser. */
export function createMyBlocksStore() {
  return new LocalMyBlocksStore()
}
