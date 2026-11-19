/**
 * Can this browser run the simulator, and on which build of MicroPython?
 *
 * The simulator's MicroPython suspends (sleep, input(), button waits) through
 * WebAssembly's JavaScript Promise Integration (JSPI; sim/DESIGN.md, section
 * 1) where the browser has it: Chrome and Edge 137 and later. Elsewhere
 * (Safari, so every iPad, and Firefox) it runs an Asyncify build of the same
 * MicroPython, larger and fetched only there. Both are chosen by testing for
 * the feature, never by the browser's name. A browser with neither would
 * start the simulator and then fail inside it, so the app asks here first and
 * says plainly why not.
 */

// The WebAssembly features the Asyncify build needs beyond the first version
// (bulk memory and reference types; Safari 15, Firefox 79), as two tiny
// modules that only validate where the feature is there.
const NEEDED = [
  // memory.fill
  [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11],
  // ref.null func, dropped
  [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 7, 1, 5, 0, 208, 112, 26, 11],
]

export function hasJSPI(scope = globalThis) {
  const wasm = scope.WebAssembly
  return typeof wasm?.Suspending === 'function' && typeof wasm?.promising === 'function'
}

function hasAsyncifyFeatures(scope) {
  const wasm = scope.WebAssembly
  if (typeof wasm?.validate !== 'function') return false
  try {
    return NEEDED.every((bytes) => wasm.validate(new Uint8Array(bytes)))
  } catch {
    return false
  }
}

/** 'jspi', 'asyncify', or null when this browser can run neither. */
export function simulatorVm(scope = globalThis) {
  if (hasJSPI(scope)) return 'jspi'
  return hasAsyncifyFeatures(scope) ? 'asyncify' : null
}

export function browserCanSimulate(scope = globalThis) {
  return simulatorVm(scope) !== null
}
