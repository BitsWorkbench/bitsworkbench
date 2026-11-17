/**
 * The mission packs a student has opened, and where they are in each, kept in
 * this browser (IndexedDB), so a pack opened from a file stays until it is
 * replaced. A pack in two files (docs/mission-packs.md) is kept as its two
 * texts and joined when read.
 */
import { readPack, readRest, joinRest, PackError } from './pack.js'

const DB = 'opencodebot-learn'
const PACKS = 'packs' // { id, text, rest? }
const PLACES = 'places' // { id, mission, step }

export class Library {
  /** Every pack kept, joined with its rest where it has one, by title. */
  async list() {
    const all = await tx(PACKS, 'readonly', (s) => s.getAll())
    return all.map(joined).sort((a, b) => a.title.localeCompare(b.title))
  }

  /** One pack by id, or null. */
  async get(id) {
    const entry = await tx(PACKS, 'readonly', (s) => s.get(id))
    return entry ? joined(entry) : null
  }

  /**
   * Keep a pack file's text: a pack (replacing one of the same id, and keeping
   * its rest if the rest still follows it), or the rest of a pack already
   * kept. Returns the pack as it now reads; throws a PackError if it is not one.
   */
  async add(text) {
    let raw
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new PackError([`not a pack file: ${err.message}`])
    }
    if (raw && typeof raw === 'object' && 'continues' in raw) {
      const rest = readRest(text)
      const entry = await tx(PACKS, 'readonly', (s) => s.get(rest.id))
      if (!entry) throw new PackError([`this is the rest of pack ${rest.id}: open the pack itself first`])
      const pack = joinRest(readPack(entry.text), rest)
      await tx(PACKS, 'readwrite', (s) => s.put({ ...entry, rest: text }))
      return pack
    }
    const pack = readPack(text)
    const old = await tx(PACKS, 'readonly', (s) => s.get(pack.id))
    const entry = { id: pack.id, text, ...(old?.rest ? { rest: old.rest } : {}) }
    await tx(PACKS, 'readwrite', (s) => s.put(entry))
    return joined(entry)
  }

  /** Where the student is in a pack: { mission, step }, or null at the pack's start. */
  async place(id) {
    const p = await tx(PLACES, 'readonly', (s) => s.get(id))
    return p ? { mission: p.mission, step: p.step } : null
  }

  async setPlace(id, place) {
    await tx(PLACES, 'readwrite', (s) => (place ? s.put({ id, ...place }) : s.delete(id)))
  }
}

/** A kept pack, with its rest if the rest still follows it. */
function joined(entry) {
  const pack = readPack(entry.text)
  if (!entry.rest) return pack
  try {
    return joinRest(pack, readRest(entry.rest))
  } catch {
    return pack
  }
}

/** One transaction on one store; resolves with the request's result once it commits. */
function tx(store, mode, request) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(PACKS, { keyPath: 'id' })
      open.result.createObjectStore(PLACES, { keyPath: 'id' })
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const t = db.transaction(store, mode)
      const req = request(t.objectStore(store))
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
