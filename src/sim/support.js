/**
 * Can this browser run the simulator?
 *
 * The simulator's MicroPython suspends through WebAssembly's JavaScript
 * Promise Integration (JSPI; sim/DESIGN.md, section 1): Chrome and Edge 137
 * and later have it. A browser without it would start the simulator and then
 * fail inside it, so the app asks here first and says plainly why not.
 */
export function browserCanSimulate(scope = globalThis) {
  const wasm = scope.WebAssembly
  return typeof wasm?.Suspending === 'function' && typeof wasm?.promising === 'function'
}
