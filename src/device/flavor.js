/**
 * Which Python a MicroPython / CircuitPython board (the `generic` target)
 * speaks. The two differ where it matters to a beginner: pins and timing
 * (`machine` and `time.ticks_ms` against `board`, `digitalio`, `analogio` and
 * `time.monotonic`). The board says which it is in its banner, so the flavor
 * follows the board once one is connected (device-manager.js); before that it
 * is MicroPython, or whatever the student last set in the device menu.
 *
 * Firia Labs boards run CircuitPython, so every other target's flavor is
 * CircuitPython: the code their blocks write does not change.
 */
const STORE = 'opencodebot.flavor.v1'

export const FLAVORS = ['micropython', 'circuitpython']

const read = () => {
  try {
    const v = localStorage.getItem(STORE)
    return FLAVORS.includes(v) ? v : null
  } catch {
    return null
  }
}

let current = read() || 'micropython'

/** Fires 'change' (detail: { flavor, from: 'board' | 'student' }) when the flavor changes. */
export const flavorEvents = new EventTarget()

/** The generic board's flavor. */
export function genericFlavor() {
  return current
}

/** Set the generic board's flavor; `from` says who: the board's banner or the student. */
export function setGenericFlavor(flavor, from = 'student') {
  if (!FLAVORS.includes(flavor) || flavor === current) return
  current = flavor
  try {
    localStorage.setItem(STORE, flavor)
  } catch { /* private window: it lasts this visit */ }
  flavorEvents.dispatchEvent(new CustomEvent('change', { detail: { flavor, from } }))
}

/** The Python a target's blocks write for: 'micropython' or 'circuitpython'. */
export function flavorOf(targetId) {
  return targetId === 'generic' ? current : 'circuitpython'
}

/** The flavor a board's banner names, or null. Firia Labs firmware is CircuitPython. */
export function flavorOfBanner(text) {
  if (/CircuitPython|FiriaLabs IoT Python/i.test(text)) return 'circuitpython'
  if (/MicroPython v?\d/.test(text)) return 'micropython'
  return null
}
