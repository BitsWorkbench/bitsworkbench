/**
 * A pack's regular expressions, kept from hanging the page. A pattern such
 * as `(a+)+$` can take longer than the universe on a line of 30 characters
 * (catastrophic backtracking), and JavaScript cannot stop a regex once it
 * starts. So two guards:
 *
 * - `riskyRegex`: the pack reader refuses the shapes that backtrack without
 *   end: a repeat inside a repeat, a repeated choice, and back-references.
 * - `RegexTester`: every test runs in a worker, on at most 1000 characters,
 *   and a test that takes over 100 ms ends the worker. That regex counts as
 *   never matching from then on, and a fresh worker takes the next test.
 */

const MAX_TEXT = 1000
const LIMIT_MS = 100

/** Why a regex could backtrack without end, or null if its shape is safe. */
export function riskyRegex(source) {
  const groups = [{ quant: false, alt: false }]
  let last = null // what a quantifier here would repeat: 'atom', a group, or null
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') {
      if (/[1-9k]/.test(source[i + 1] ?? '')) return 'a back-reference'
      i++
      last = 'atom'
    } else if (c === '[') {
      for (i++; i < source.length && source[i] !== ']'; i++) if (source[i] === '\\') i++
      last = 'atom'
    } else if (c === '(') {
      groups.push({ quant: false, alt: false })
      if (source[i + 1] === '?') {
        // (?: (?= (?! take two characters, (?<= (?<! three, and (?<name> up to its '>'.
        if (source[i + 2] !== '<') i += 2
        else if (source[i + 3] === '=' || source[i + 3] === '!') i += 3
        else i = source.indexOf('>', i)
      }
      last = null
    } else if (c === ')') {
      const group = groups.pop()
      if (!groups.length) return null // unbalanced: the RegExp constructor reports it
      groups.at(-1).quant ||= group.quant
      last = group
    } else if (c === '|') {
      groups.at(-1).alt = true
      last = null
    } else if (c === '*' || c === '+' || c === '?' || (c === '{' && /^\{\d+(,\d*)?\}/.test(source.slice(i)))) {
      if (c === '{') i = source.indexOf('}', i)
      if (source[i + 1] === '?') i++ // lazy
      // `?` repeats nothing, so only the other quantifiers can repeat a group.
      if (c !== '?' && last && last !== 'atom') {
        if (last.quant) return 'a repeat inside a repeat'
        if (last.alt) return 'a repeated choice'
      }
      groups.at(-1).quant = true
      last = null
    } else {
      last = 'atom'
    }
  }
  return null
}

/** Tests a pack's regexes in a worker, time-boxed. */
export class RegexTester {
  /**
   * `makeWorker()` makes a worker that posts `{ ready: true }` once loaded and
   * answers `{ id, source, text }` with `{ id, match }`. `startLimitMs`: how long
   * a worker may take to load (a slow phone, a cold cache) before the test is
   * given up, without blaming the regex.
   */
  constructor({ makeWorker = () => new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' }), startLimitMs = 10000 } = {}) {
    this.makeWorker = makeWorker
    this.startLimitMs = startLimitMs
    this.worker = null // { worker, ready: Promise<boolean> }
    this.slow = new Set()
    this.queue = Promise.resolve()
    this.id = 0
  }

  /** Does `source` match `text`? False for a regex that was too slow before, or is now. */
  test(source, text) {
    const run = () => (this.slow.has(source) ? false : this._ask(source, String(text).slice(0, MAX_TEXT)))
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  /** A loaded worker, or null if one would not load in time (it is dropped, and the next test makes another). */
  async _loaded() {
    if (!this.worker) {
      const worker = this.makeWorker()
      const ready = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), this.startLimitMs)
        worker.addEventListener('message', function onReady(e) {
          if (!e.data?.ready) return
          clearTimeout(timer)
          worker.removeEventListener('message', onReady)
          resolve(true)
        })
      })
      this.worker = { worker, ready }
    }
    const { worker, ready } = this.worker
    if (await ready) return worker
    worker.terminate()
    if (this.worker?.worker === worker) this.worker = null
    console.warn('The worker that tests mission packs\' regular expressions did not start in time.')
    return null
  }

  async _ask(source, text) {
    // The clock starts once the worker has loaded: its start-up is not the regex's time.
    const worker = await this._loaded()
    if (!worker) return false
    const id = ++this.id
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMessage)
        worker.terminate()
        this.worker = null
        this.slow.add(source)
        console.warn(`A mission pack's regular expression took too long, so it never matches: /${source}/`)
        resolve(false)
      }, LIMIT_MS)
      const onMessage = (e) => {
        if (e.data.id !== id) return
        clearTimeout(timer)
        worker.removeEventListener('message', onMessage)
        resolve(e.data.match)
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ id, source, text })
    })
  }
}
