// Realism: how much the page spends drawing the simulator, from an old
// Chromebook to a gaming PC. It changes only what is drawn (and the settings
// panel's sound): the world steps the same 1 ms tick with the same sensors,
// physics and seeded noise at every level, so a program behaves the same on
// every machine (sim/DESIGN.md, section 4).
//
//   ratio      device pixels per CSS pixel, at most (never above the screen's)
//   antialias  smoothed edges (set when the view is made: it follows a change
//              at the simulator's next start)
//   shadows    the soft shadows under the robots
//   effects    the glow around lit LEDs and NeoPixels
//   anisotropy texture sharpness on the floor at a glancing angle
//   fps        frames a second at most; 0 for as many as the screen shows
export const LEVELS = ['low', 'medium', 'high', 'ultra']

export const PRESETS = {
  low: { ratio: 0.6, antialias: false, shadows: false, effects: false, anisotropy: 1, fps: 30 },
  medium: { ratio: 1, antialias: false, shadows: true, effects: true, anisotropy: 2, fps: 60 },
  high: { ratio: 1.5, antialias: true, shadows: true, effects: true, anisotropy: 4, fps: 60 },
  ultra: { ratio: 2, antialias: true, shadows: true, effects: true, anisotropy: 8, fps: 0 },
}

// Auto's first level, before it has measured anything: from the graphics
// chip, so the simulator looks its best from its first frame on a capable
// machine and is light from its first frame on a weak one. `gpu` is the
// chip's name as WebGL gives it (gpuName). A chip it does not know starts
// at Medium.
//   low     drawn in software (no graphics chip the browser will use)
//   medium  a phone's or a Chromebook's chip (Mali, Adreno, PowerVR, older
//           Intel HD), and any chip it does not know
//   high    a laptop's recent integrated chip (Intel Iris or Arc, AMD
//           Radeon in a Ryzen, Apple's)
//   ultra   a graphics card (NVIDIA, AMD Radeon RX or Pro), or Apple's M
//           Pro, Max or Ultra
export function guessLevel(gpu = '') {
  const g = String(gpu).toLowerCase()
  if (!g) return 'medium'
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) return 'low'
  if (/geforce|rtx|gtx|quadro|nvidia|radeon (rx|pro)|apple m\d+ (pro|max|ultra)/.test(g)) return 'ultra'
  if (/iris|\barc\b|radeon|apple/.test(g)) return 'high'
  return 'medium'
}

// The graphics chip's name, as WebGL gives it ('' when it says nothing):
// asked of a canvas of its own, before the view makes its renderer, so the
// first level's antialiasing is right from the start.
export function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')
    if (!gl) return ''
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name || '')
  } catch {
    return ''
  }
}

// Auto: starts where it settled last time (from the graphics chip the first
// time, guessLevel), and moves
// a level at a time from the frame rate it measures while it draws:
//   down  below 24 frames a second for 2 seconds running
//   up    at 95% of the level's frame cap (of 60 where it has none) for
//         8 seconds running
// and never back up to a level it has come down from, so it settles rather
// than flapping. Fed one measurement a second (frames over a second of
// drawing); returns the level to draw at. The first WARMUP measurements are
// not counted: they are the room loading and the chip compiling its
// shaders, slow on every machine, and once moved Auto to Low for good on
// machines that draw the simulator easily.
export const WARMUP = 3

export class AutoRealism {
  constructor(start = 'medium') {
    this.level = LEVELS.includes(start) ? start : 'medium'
    this.slow = 0
    this.fast = 0
    this.warm = 0
    this.ceiling = LEVELS.length - 1     // the highest level it may go up to
  }

  measure(fps) {
    if (this.warm < WARMUP) { this.warm++; return this.level }
    const i = LEVELS.indexOf(this.level)
    const cap = PRESETS[this.level].fps || 60
    if (fps < 24) { this.slow++; this.fast = 0 } else { this.slow = 0 }
    if (fps >= cap * 0.95) this.fast++
    else this.fast = 0
    if (this.slow >= 2 && i > 0) {
      this.ceiling = i - 1
      this._go(LEVELS[i - 1])
    } else if (this.fast >= 8 && i < this.ceiling) {
      this._go(LEVELS[i + 1])
    }
    return this.level
  }

  _go(level) {
    this.level = level
    this.slow = this.fast = 0
  }
}
