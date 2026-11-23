/**
 * A journey's effects (docs/mission-packs.md, "Journeys", `fx`): the motion
 * that shows a student what to do and answers what they did. Each is a short
 * moment, drawn in a layer of its own over the app that never takes a click.
 *
 *   ghost                   while a block step waits: the block flies from
 *                           the palette to where it goes (`to`), with a hand
 *   beam <place> > <place>  once met: a line of light from one place to
 *                           another (to each part, for `part:`)
 *   zoom <place>            once met: a magnifier on the board's screen
 *   pulse <place>           once met: each part glows and sends out rings
 *   morph                   once met: each of the student's blocks lights in
 *                           turn, one line of the program each
 *
 * The opening sweeps a light over the simulator; the finish throws confetti.
 *
 * The rules (measured in the design study): animate transform and opacity
 * only, no filters on anything that moves, every effect a moment that ends.
 * Under reduced motion (`:root[data-motion=reduce]` or the system setting)
 * nothing moves: the ghost stands still where the block goes, the beam is a
 * still line, the parts glow without rings, the confetti stays away.
 */
const WAITING = ['ghost'] // the effects shown while a step waits; the rest answer it
const BLOCKS_ONLY = ['ghost', 'morph'] // made of blocks: none in Python, where the coach's ring does the pointing
const name = (fx) => fx.split(' ')[0]
const arg = (fx) => fx.slice(fx.indexOf(' ') + 1).trim()
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2]

export class Effects {
  /** `places`: the journey's Places, for boxes on the page, the program and the board's screen. */
  constructor({ places }) {
    this.places = places
    this.layer = document.createElement('div')
    this.layer.className = 'journey-fx'
    this.layer.setAttribute('aria-hidden', 'true')
    document.body.append(this.layer)
    this.timers = []
  }

  get reduced() {
    return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /** Everything drawn goes, and anything waiting to be drawn. */
  clear() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    this.layer.replaceChildren()
  }

  /** Does a step have a "Show me" (a ghost to play again)? */
  hasHelp(step) {
    return !this._python() && !!step?.fx?.some((f) => name(f) === 'ghost') && !!step.point && !!step.to
  }

  /** In Python, only the effects that are not made of blocks. */
  _python() {
    return !!this.places.python?.()
  }

  _plays(fx) {
    return !(this._python() && BLOCKS_ONLY.includes(name(fx)))
  }

  /** The student's program as Python, for the `compare` card. */
  programText() {
    return this.places.programText()
  }

  /** A step waits for the student: its waiting effects; `again`, played on request. */
  waiting(step, { again = false } = {}) {
    if (again) this.clear()
    for (const fx of step.fx || []) if (WAITING.includes(name(fx)) && this._plays(fx)) this._later(() => this[name(fx)](step), again ? 0 : 450)
  }

  /** A step is met: the effects that answer it. */
  met(step) {
    this.clear()
    for (const fx of step.fx || []) {
      const n = name(fx)
      if (!WAITING.includes(n) && this[n] && this._plays(fx)) this._later(() => this[n](arg(fx)), 120)
    }
  }

  opening() {
    this.clear()
    if (this.reduced) return
    const sim = this.places.resolve('sim')?.box
    if (!sim) return
    const clip = this._add('div', 'journey-fx-clip', sim)
    const band = document.createElement('div')
    band.className = 'journey-fx-sweep'
    clip.append(band)
    band.animate([{ transform: 'translateX(-140px)' }, { transform: `translateX(${sim.w + 20}px)` }], { duration: 1600, easing: 'ease-in-out', fill: 'both' })
    this._later(() => clip.remove(), 1800)
  }

  finish() {
    this.clear()
    if (this.reduced) return
    const colours = ['#f4d038', '#2e7d32', '#e53935', '#1e88e5', '#8e24aa']
    const h = innerHeight
    for (let i = 0; i < 70; i++) {
      const c = this._add('i', 'journey-fx-confetti', { x: Math.random() * innerWidth, y: -20, w: 8, h: 12 })
      c.style.background = colours[i % colours.length]
      c.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${h + 40}px) rotate(${540 + Math.random() * 360}deg)` }],
        { duration: 1800 + Math.random() * 1400, delay: Math.random() * 900, easing: 'linear', fill: 'both' })
    }
    this._later(() => this.clear(), 4200)
  }

  // ------------------------------------------------------------ the effects

  /** The block flies from the palette to where it goes; under reduced motion it stands there, faint. */
  ghost(step) {
    const from = this.places.resolve(step.point)
    const to = this.places.resolve(step.to)?.box
    if (!from?.block || !to) return
    const f = from.box
    this._add('div', 'journey-fx-slot', { x: to.x, y: to.y, w: f.w * 0.9, h: Math.max(f.h - 6, 24) })
    const ghost = this._blockPicture(from.block, f)
    if (!ghost) return
    const dx = to.x - f.x
    const dy = to.y - f.y
    if (this.reduced) {
      ghost.style.transform = `translate(${dx}px, ${dy}px)`
      ghost.style.opacity = 0.5
      return
    }
    const path = [
      { transform: 'translate(0, 0) scale(1)', opacity: 0, offset: 0 },
      { transform: 'translate(0, 0) scale(1.04)', opacity: 0.9, offset: 0.12 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) rotate(-3deg)`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.9, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0, offset: 1 },
    ]
    const timing = { duration: 2600, iterations: 2, easing: 'ease-in-out', fill: 'both' }
    ghost.animate(path, timing)
    const hand = this._add('div', 'journey-fx-hand', { x: f.x + Math.min(30, f.w / 2), y: f.y + f.h / 2, w: 30, h: 30 })
    hand.textContent = '👆'
    hand.animate(path.map((k) => ({ ...k, transform: k.transform.replace(/ scale\([^)]*\)| rotate\([^)]*\)/g, '') })), timing)
    this._later(() => { ghost.remove(); hand.remove() }, 2600 * 2 + 100)
  }

  /** A line of light from one place to another, or to each of several parts. */
  beam(text) {
    const [fromPlace, toPlace] = text.split(' > ').map((s) => s.trim())
    const from = this.places.boxes(fromPlace)[0]
    const ends = this.places.boxes(toPlace)
    if (!from || !ends.length) return
    const sx = from.x + from.w
    const sy = from.y + from.h / 2
    const paths = ends.map((b) => {
      const [ex, ey] = centre(b)
      const bend = Math.min(160, Math.abs(ex - sx) / 2)
      return `<path d="M${sx},${sy} C${sx + bend},${sy - 100} ${ex - bend},${ey + 60} ${ex},${ey}"/>`
    })
    const svg = this._svg(`<g class="journey-fx-beam">${paths.join('')}</g>`)
    if (!this.reduced) svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' })
    this._later(() => {
      if (this.reduced) return svg.remove()
      svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }).finished.then(() => svg.remove(), () => {})
    }, 2800)
  }

  /** A magnifier on what the board's screen shows, beside it, joined to it by a dotted line. */
  zoom(place) {
    const at = this.places.boxes(place)[0]
    const view = this.places.sim()
    const sim = this.places.resolve('sim')?.box
    if (!at || !view?.screenImage || !sim) return
    // Beside the screen, inside the simulator: the left if it fits, else the side with more room.
    const roomL = at.x - sim.x - 16
    const roomR = sim.x + sim.w - (at.x + at.w) - 16
    const onLeft = roomL >= 110 || roomL > roomR
    const d = Math.max(90, Math.min(160, onLeft ? roomL : roomR, sim.h - 40))
    const left = onLeft ? at.x - d - 12 : at.x + at.w + 12
    const top = Math.max(sim.y + 30, Math.min(at.y + at.h / 2 - d / 2, sim.y + sim.h - d - 6))
    const [cx, cy] = centre(at)
    this._svg(`<line class="journey-fx-tether" x1="${onLeft ? left + d : left}" y1="${top + d / 2}" x2="${cx}" y2="${cy}"/>
      <rect class="journey-fx-tether" x="${at.x}" y="${at.y}" width="${at.w}" height="${at.h}" rx="4"/>`)
    const lens = this._add('div', 'journey-fx-lens', { x: left, y: top, w: d, h: d })
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2 * d
    lens.append(canvas)
    const draw = () => magnify(view.screenImage(), canvas)
    draw()
    // The program may still be drawing: the lens follows the screen for a while.
    const live = setInterval(() => (lens.isConnected ? draw() : clearInterval(live)), 250)
    this._later(() => clearInterval(live), 6000)
    if (!this.reduced) lens.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'ease-out' })
  }

  /** Each part glows; with motion, rings go out from it. */
  pulse(place) {
    for (const b of this.places.boxes(place)) {
      const [x, y] = centre(b)
      const r = Math.max(13, Math.min(b.w, b.h))
      this._add('div', 'journey-fx-glow', { x: x - r, y: y - r, w: r * 2, h: r * 2 })
      if (this.reduced) continue
      for (const delay of [0, 700]) {
        const wave = this._add('div', 'journey-fx-wave', { x: x - 7, y: y - 7, w: 14, h: 14 })
        wave.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(4.2)', opacity: 0 }], { duration: 1400, delay, iterations: 2, easing: 'ease-out', fill: 'both' })
      }
    }
    this._later(() => this.layer.querySelectorAll('.journey-fx-glow').forEach((g) => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' })), 3400)
  }

  /** Each of the student's blocks lights in turn: one block, one line of Python. */
  morph() {
    const blocks = this.places.programBlocks()
    blocks.forEach((block, i) => {
      const box = this._blockBox(block)
      if (!box) return
      const bar = this._add('div', 'journey-fx-morph', box)
      if (this.reduced) return
      bar.animate([{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.6 }, { transform: 'scaleX(1)', opacity: 0 }],
        { duration: 1400, delay: i * 350, easing: 'ease-out', fill: 'both' })
    })
  }

  // ------------------------------------------------------------ drawing

  _later(fn, ms) {
    this.timers.push(setTimeout(fn, ms))
  }

  _add(tag, cls, { x, y, w, h }) {
    const el = document.createElement(tag)
    el.className = cls
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    this.layer.append(el)
    return el
  }

  _svg(inner) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'journey-fx-svg')
    svg.setAttribute('width', innerWidth)
    svg.setAttribute('height', innerHeight)
    svg.innerHTML = inner
    this.layer.append(svg)
    return svg
  }

  /** A block's own row on the page (not the blocks after it). */
  _blockBox(block) {
    const r = block.getSvgRoot()?.getBoundingClientRect()
    if (!r || !r.width) return null
    const scale = block.workspace.scale || 1
    return { x: r.left, y: r.top, w: Math.min(r.width, block.width * scale + 4), h: Math.min(r.height, block.height * scale) }
  }

  /** A copy of a palette block's picture, over it, in the palette's own styles. */
  _blockPicture(block, box) {
    const root = block.getSvgRoot()
    const host = block.workspace.getInjectionDiv?.() ?? root.closest('.injectionDiv')
    if (!root) return null
    const wrap = this._add('div', `journey-fx-ghost ${host?.className ?? ''}`, box)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'blocklySvg')
    svg.setAttribute('width', box.w)
    svg.setAttribute('height', box.h)
    svg.style.overflow = 'visible'
    const copy = root.cloneNode(true)
    // Where the block's picture starts within its own group, at the palette's scale.
    const bb = root.getBBox()
    const scale = block.workspace.scale || 1
    copy.setAttribute('transform', `scale(${scale}) translate(${-bb.x}, ${-bb.y})`)
    svg.append(copy)
    wrap.append(svg)
    return wrap
  }
}


/**
 * Draw the lit part of a screen's picture, as large as fits in a circle, into
 * `canvas`: a student's few words sit in a corner of a dark screen, and a
 * magnifier on the whole screen would show only the dark.
 */
function magnify(image, canvas) {
  const { width: W, height: H, data } = image
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      if (data[o] + data[o + 1] + data[o + 2] > 60) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  // Nothing lit: the whole screen. Else a square centred on what is, with a margin.
  let side = W, sx = 0, sy = 0
  if (x1 >= 0) {
    side = Math.min(W, Math.max(48, x1 - x0 + 1, y1 - y0 + 1) * 1.15)
    sx = (x0 + x1) / 2 - side / 2
    sy = (y0 + y1) / 2 - side / 2
  }
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  src.getContext('2d').putImageData(image, 0, 0)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // The circle's inscribed square holds the picture, so no corner of it is cut off.
  const inner = canvas.width / Math.SQRT2
  const pad = (canvas.width - inner) / 2
  const k = inner / side
  ctx.drawImage(src, pad - sx * k, pad - sy * k, W * k, H * k)
}
