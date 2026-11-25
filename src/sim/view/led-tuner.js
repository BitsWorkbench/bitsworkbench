/**
 * The LED tuner: a hidden panel for setting how lit LEDs and NeoPixels look
 * (led.js, LOOKS), live, board by board, and copying the numbers out to make
 * them the defaults (LOOK_DEFAULTS).
 *
 * Not in the app's menus. It opens with `?tune=leds` in the page's address,
 * or Ctrl+Alt+Shift+L anywhere in the app with the simulator open (the same
 * again closes it). Its numbers are kept in this browser (localStorage) and
 * used only while it is open: nobody else's simulator changes, and closing
 * it puts the defaults back.
 */
import { LOOKS, LOOK_DEFAULTS } from './led.js'

const KEPT = 'opencodebot.ledTuner.v1'
const SLIDERS = [
  ['colour', 'Body colour (painted)', 0, 1, 0.05],
  ['emissive', 'Emissive (past 1: hotter, toward white)', 0, 4, 0.05],
  ['opacity', 'Body opacity', 0, 1, 0.05],
  ['glow', 'Glow strength', 0, 3, 0.05],
  ['size', 'Glow size', 0.25, 4, 0.05],
]
const CHECKS = [
  ['add', 'Glow added as light (not laid over)'],
  ['toneMap', 'Body through the tone curve'],
]
// A program that lights every light on the board, and keeps them lit until Stop.
const LIGHT_ALL = {
  codebot: 'from botcore import *\nimport time\nleds.user(0xFF)\nleds.ls(0x1F)\nleds.prox(3)\nleds.pwr(True)\nwhile True:\n    time.sleep(1)\n',
  codex: 'from codex import *\nimport time\nleds.set(0x3F)\nfor n, c in enumerate([(255, 0, 0), (255, 165, 0), (0, 255, 0), (0, 80, 255)]):\n    pixels.set(n, c)\nwhile True:\n    time.sleep(1)\n',
}

/** Whether the page asked for the tuner (`?tune=leds`). */
export function asked() {
  return new URLSearchParams(location.search).get('tune') === 'leds'
}

/** Whether `e` is the tuner's key chord. */
export function chord(e) {
  return e.code === 'KeyL' && e.ctrlKey && e.altKey && e.shiftKey
}

let panel = null

/** Open the tuner over `view` (view.js), or close it if open. */
export function toggle(view) {
  if (panel) return close()
  open(view)
}

function boardOf(view) {
  for (const f of view.figures.values()) {
    const look = f.lights?.[0]?.look
    const board = Object.keys(LOOKS).find((k) => LOOKS[k] === look)
    if (board) return board
  }
  return 'codebot'
}

function redraw(view) {
  for (const f of view.figures.values()) for (const l of f.lights ?? []) l.refresh()
  view._touch?.()
}

function keep() {
  try {
    localStorage.setItem(KEPT, JSON.stringify(LOOKS))
  } catch {
    // storage blocked: the numbers last until the page goes
  }
}

// Numbers for the looks, from text (the panel's box, or what was kept): only
// the boards and fields the defaults have, each of the right kind.
function apply(text) {
  const given = JSON.parse(text)
  for (const [board, look] of Object.entries(given ?? {})) {
    if (!LOOKS[board] || typeof look !== 'object') continue
    for (const [k, v] of Object.entries(look)) {
      if (!(k in LOOK_DEFAULTS[board])) continue
      if (typeof v === typeof LOOK_DEFAULTS[board][k]) LOOKS[board][k] = v
    }
  }
}

function reset(board) {
  for (const b of board ? [board] : Object.keys(LOOKS)) Object.assign(LOOKS[b], LOOK_DEFAULTS[b])
}

export function open(view) {
  if (panel) return
  try {
    const kept = localStorage.getItem(KEPT)
    if (kept) apply(kept)
  } catch {
    // nothing kept, or nothing readable: the defaults
  }
  let board = boardOf(view)
  panel = document.createElement('aside')
  panel.className = 'led-tuner'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'LED tuner')
  panel.innerHTML = `<style>
    .led-tuner { position: fixed; left: 12px; top: 12px; z-index: 5000; width: 300px; max-height: calc(100vh - 24px); overflow: auto;
      background: var(--surface, #fff); color: var(--ink, #222); border: 2px solid var(--line, #ccc); border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 10px 12px; font: 13px/1.35 system-ui, sans-serif; }
    .led-tuner h2 { font-size: 15px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: center; }
    .led-tuner label { display: block; margin: 6px 0 0; }
    .led-tuner .row { display: grid; grid-template-columns: 1fr 44px; gap: 6px; align-items: center; }
    .led-tuner input[type=range] { width: 100%; }
    .led-tuner output { font-variant-numeric: tabular-nums; text-align: right; }
    .led-tuner textarea { width: 100%; box-sizing: border-box; height: 120px; font: 11px/1.3 ui-monospace, monospace; margin-top: 6px; }
    .led-tuner .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .led-tuner button, .led-tuner select { font: inherit; padding: 3px 8px; }
    .led-tuner .note { color: var(--ink-soft, #666); font-size: 11px; margin: 6px 0 0; }
  </style>
  <h2>LED tuner <button type="button" data-t="close" aria-label="Close">✕</button></h2>
  <label>Board <select data-t="board">${Object.keys(LOOKS).map((b) => `<option value="${b}">${b}</option>`).join('')}</select></label>
  ${SLIDERS.map(([k, name, min, max, step]) => `<label>${name}<span class="row"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><output data-o="${k}"></output></span></label>`).join('')}
  ${CHECKS.map(([k, name]) => `<label><input type="checkbox" data-k="${k}"> ${name}</label>`).join('')}
  <div class="buttons">
    <button type="button" data-t="light">Light them all</button>
    <button type="button" data-t="reset">This board's defaults</button>
    <button type="button" data-t="copy">Copy numbers</button>
  </div>
  <textarea data-t="json" spellcheck="false" aria-label="The numbers, for every board (edit or paste to set them)"></textarea>
  <p class="note">Every board's numbers, as JSON: copy them to make them the defaults (LOOK_DEFAULTS in src/sim/view/led.js), or paste numbers here to set them. Kept in this browser, used only while the tuner is open. Ctrl+Alt+Shift+L closes it.</p>`
  document.body.append(panel)
  const $ = (s) => panel.querySelector(s)
  const show = () => {
    $('[data-t="board"]').value = board
    for (const [k] of SLIDERS) {
      $(`input[data-k="${k}"]`).value = LOOKS[board][k]
      $(`output[data-o="${k}"]`).textContent = Number(LOOKS[board][k]).toFixed(2)
    }
    for (const [k] of CHECKS) $(`input[data-k="${k}"]`).checked = LOOKS[board][k]
    const json = $('[data-t="json"]')
    if (document.activeElement !== json) json.value = JSON.stringify(LOOKS, null, 1).replace(/\n {2,}/g, ' ').replace(/\n }/g, ' }')
    $('[data-t="light"]').disabled = !LIGHT_ALL[board]
  }
  const changed = () => {
    keep()
    redraw(view)
    show()
  }
  panel.addEventListener('input', (e) => {
    const k = e.target.dataset.k
    if (k) {
      LOOKS[board][k] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value)
      return changed()
    }
    if (e.target.dataset.t === 'board') {
      board = e.target.value
      return show()
    }
    if (e.target.dataset.t === 'json') {
      try {
        apply(e.target.value)
        keep()
        redraw(view)
        show()
      } catch {
        // not JSON yet: wait for more
      }
    }
  })
  panel.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t
    if (t === 'close') close()
    if (t === 'reset') { reset(board); changed() }
    if (t === 'copy') {
      const json = $('[data-t="json"]')
      try {
        await navigator.clipboard.writeText(json.value)
      } catch {
        json.select()
        document.execCommand?.('copy')
      }
    }
    if (t === 'light' && LIGHT_ALL[board]) globalThis.openCodeBot?.device?.run(LIGHT_ALL[board])
  })
  panel.view = view
  show()
  redraw(view)
}

export function close() {
  if (!panel) return
  const view = panel.view
  panel.remove()
  panel = null
  reset()
  redraw(view)
}
