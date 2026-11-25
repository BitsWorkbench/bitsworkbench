// The simulator's picture: a Three.js scene of the room and the devices in
// it, drawn from the snapshots the world sends. It owns no state the program
// can see; the world decides where everything is.
//
// Coordinates: the world's (x east, y north, z up) is Three's (x, z up -> y,
// north -> -z); a heading h is a rotation of h about Three's +y.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CodeBotFigure } from './codebot-figure.js'
import { CodeAIRFigure } from './codeair-figure.js'
import { CodeXFigure, TILT_MAX } from './codex-figure.js'
import { courseMesh } from './course-mesh.js'
import { CameraRig } from './camera-rig.js'
import { PRESETS, AutoRealism, guessLevel, gpuName } from './realism.js'
import { settings } from '../settings.js'
import * as tuner from './led-tuner.js'

const FIGURES = { codebot: CodeBotFigure, codeair: CodeAIRFigure, codex: CodeXFigure }
const SKY = 0xdfe8ef
const ROBOT_CLOSEST = 0.12      // m, the nearest the camera comes to a robot
const ORBIT = Math.PI / 4       // turned this far, the student has looked around

export class SimView {
  // `buttons`, for a board whose buttons the view presses (every board):
  // { keys, onButton, fullScreen }, keys from KeyboardEvent.key to a button's
  // number, onButton(n, down). Its buttons are then pressed by a click on the
  // model (the figure's keyAt, keys.js) and by those keys, which the camera
  // then no longer takes; with fullScreen, F goes full screen. With
  // `onTilt(x, y)` too (radians, world/codex.js tiltX and tiltY), a drag on
  // the figure's rotation arrows tilts the board, as do Shift and the arrow
  // keys (5 degrees a press); Home sets it level.
  // `onPick(name)`: a click on a board names the part it lands on (parts.js).
  // `onOrbit()`: the student has turned the camera 45 degrees, by drag or
  // key, in all since the last time (a mission's `orbit` event).
  constructor(host, { assetsBase, buttons = null, onPick = null, onOrbit = null }) {
    this.host = host
    this.onOrbit = onOrbit
    this.assetsBase = assetsBase
    this.buttons = buttons
    this.onPick = onPick
    this.down = new Set()
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    this.figures = new Map()
    this.frames = [null, null]      // the two latest snapshots, with arrival times
    this._snaps = []                // the recent snapshots, for the playout clock (_current)
    this._play = null               // the playout clock: the simulated time drawn (µs)

    // Realism (realism.js): chosen in the settings panel, or Auto, which
    // starts from the graphics chip (where it settled last time, after the
    // first) and moves a level at a time from the frame rate it measures. A
    // school Chromebook's GPU gets fewer pixels and effects rather than fewer
    // frames.
    if (settings.realism === 'auto' && !settings.autoLevel) settings.setAutoLevel(guessLevel(gpuName()))
    this.auto = new AutoRealism(settings.autoLevel ?? 'medium')
    this.level = settings.realism === 'auto' ? this.auto.level : settings.realism
    this.fps = null                 // frames a second, the last second drawn; null at rest
    this._gov = { last: 0, sum: 0, n: 0, drawn: 0 }
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: PRESETS[this.level].antialias, powerPreference: 'low-power' }))
    this._realism()
    this._onSettings = (e) => {
      if (e.detail !== 'realism') return
      if (settings.realism === 'auto') this.auto = new AutoRealism(this.level)
      this._realism()
    }
    settings.addEventListener('change', this._onSettings)
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(r.domElement)
    r.domElement.className = 'sim-canvas'

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SKY)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5b4b, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(3, 8, 2)
    this.scene.add(sun)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200)
    this.camera.position.set(0.6, 0.5, 0.6)
    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.enableDamping = true
    this.controls.minDistance = ROBOT_CLOSEST
    this.controls.maxDistance = 30
    this.controls.addEventListener('change', () => this._touch())
    // The cameras (camera-rig.js); the keyboard moves them with the view
    // focused, unless a board's key takes the key first.
    const canvas = r.domElement
    this.rig = new CameraRig(this.camera, this.controls, canvas, () => this._touch())
    this.rig.setMode('rotate')
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + -' + (buttons?.onTilt ? ' Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Home' : ''))
    const key = (e) => {
      if (this.buttons && this._buttonKey(e)) return
      const before = this._offset()
      if (this.rig.key(e)) this._turned(this._offset().angleTo(before))
    }
    // A drag that turns the camera, a step at a time.
    let last = null
    this.controls.addEventListener('start', () => { last = this._offset() })
    this.controls.addEventListener('end', () => { last = null })
    this.controls.addEventListener('change', () => {
      if (!last) return
      const now = this._offset()
      this._turned(now.angleTo(last))
      last = now
    })
    this._turnedBy = 0
    canvas.addEventListener('keydown', key)
    canvas.addEventListener('keyup', key)
    canvas.addEventListener('blur', () => { this._releaseAll(); this.rig.held.clear() })
    if (buttons) this._bindPointer(canvas)
    this._changedAt = 0           // when the picture last had reason to change
    // The LED tuner's key chord, anywhere in the app (led-tuner.js).
    this._onTunerKey = (e) => {
      if (!tuner.chord(e)) return
      e.preventDefault()
      tuner.toggle(this)
    }
    addEventListener('keydown', this._onTunerKey)

    this._resize = new ResizeObserver(() => this.resize())
    this._resize.observe(host)
    this.resize()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  // The way the camera looks at what it turns round, as a unit vector.
  _offset() {
    return this.camera.position.clone().sub(this.controls.target).normalize()
  }

  // Count turning from now (a new step asking for it starts from nothing).
  resetTurn() {
    this._turnedBy = 0
  }

  // The camera turned by `radians`: 45 degrees in all is an orbit.
  _turned(radians) {
    if (!(radians > 0)) return
    this._turnedBy += radians
    if (this._turnedBy < ORBIT) return
    this._turnedBy = 0
    this.onOrbit?.()
  }

  // What a screen reader names and describes (sim/describe.js).
  get focusEl() {
    return this.renderer.domElement
  }

  async loadRoom(id) {
    const ask = (this._roomAsked = id)
    const room = id === 'showroom' ? this._showroom() : (await this.loader.loadAsync(`${this.assetsBase}env/${id}/room.glb`)).scene
    if (ask !== this._roomAsked) return        // another room was chosen meanwhile
    this.room?.removeFromParent()
    // the last room's buffers and textures, off the GPU
    this.room?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [o.material].flat()) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
        m.dispose()
      }
    })
    this.room = room
    // The rooms are modelled at 1 unit = 10 cm; the showroom is built in metres.
    if (id !== 'showroom') room.scale.setScalar(0.1)
    this.scene.background = id === 'showroom' ? room.userData.sky : new THREE.Color(SKY)
    this.scene.environment = id === 'showroom' ? this._studio() : null
    this.scene.add(this.room)
    this._realism()
    this.roomId = id
    this._touch()
  }

  // The showroom, CodeSpace's room for a board held up to look at: a black
  // floor a metre square with a teal grid at 10 cm (brighter on its centre
  // lines), under a slate sky, lit as a photographer's studio (_studio).
  _showroom() {
    const room = new THREE.Group()
    room.userData.sky = new THREE.Color().setRGB(0.2, 0.2, 0.3, THREE.SRGBColorSpace)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000 }))
    floor.rotation.x = -Math.PI / 2
    room.add(floor)
    const lines = (coords, color) => {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(...color, THREE.SRGBColorSpace), toneMapped: false }))
      l.position.y = 0.0005
      room.add(l)
    }
    const minor = [], major = []
    for (let i = -5; i <= 5; i++) {
      const at = i / 10
      const to = i === 0 ? major : minor
      to.push(at, 0, -0.5, at, 0, 0.5, -0.5, 0, at, 0.5, 0, at)
    }
    lines(minor, [0, 0.29, 0.29])
    lines(major, [0, 0.9, 0.9])
    return room
  }

  // Studio light for metal and glass to reflect: the showroom's, and the
  // robots' metal in every room (led.js, reflect). Three's RoomEnvironment,
  // made once.
  _studio() {
    if (!this._studioTex) {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this._studioTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
    }
    return this._studioTex
  }

  // The line course on the floor (its shape from world/courses.js), or none.
  setCourse(shape) {
    this.course?.removeFromParent()
    this.course = shape ? courseMesh(shape) : null
    if (this.course) this.scene.add(this.course)
    this._touch()
  }

  async addDevice(snap) {
    const Figure = FIGURES[snap.kind]
    const fig = new Figure()
    await fig.load(this.loader, this.assetsBase, this._studio())
    this.scene.add(fig.root)
    this.figures.set(snap.id, fig)
    this._realism()
    this._touch()
    fig.update(snap)
    // The LED tuner, asked for in the page's address (led-tuner.js), opens once there are lights to tune.
    if (tuner.asked()) tuner.open(this)
    if (fig.home) {
      // a board that stays put: the camera starts where the figure says, and turns
      // round it (from a direction, near enough for its size to fit the view's narrower way)
      const h = fig.home()
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect))
      this.rig.setMode('rotate')
      this.controls.target.copy(h.target)
      this.camera.position.copy(h.target).addScaledVector(h.from, (h.size * 0.55) / Math.tan(half))
      this.controls.minDistance = h.minDistance
    } else {
      // how near the camera may come: a figure's own (CodeAIR, small, comes
      // closer, to its LEDs and buttons), or a robot's
      this.controls.minDistance = fig.closest ?? ROBOT_CLOSEST
      this.rig.aim = fig.aim ?? 0.04
      this._placeCamera(snap, true)
    }
    return fig
  }

  // A new picture for a board's screen (CodeX): RGB565 pixels.
  screen(px) {
    for (const f of this.figures.values()) f.screenPixels?.(px)
    this._touch()
  }

  // The screen's colour at (x, y), for the tests: [r, g, b].
  screenRGB(x, y) {
    for (const f of this.figures.values()) if (f.screenRGB) return f.screenRGB(x, y)
    return null
  }

  // Where key n of a board's model is on the page, for the tests: { x, y }.
  keyPoint(n) {
    for (const f of this.figures.values()) {
      const p = f.keyCentre?.(n)
      if (!p) continue
      p.project(this.camera)
      const r = this.renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    }
    return null
  }

  // The box on the page around the parts of a board's model whose names
  // match `re`, for a mission journey to point at: { x, y, w, h }, or null.
  partBox(re) {
    const boxes = this.partBoxes(re)
    if (!boxes.length) return null
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h))
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  // Each matching part's own box on the page, in model order (a journey's
  // effect lights each NeoPixel): [{ name, x, y, w, h }], those on screen.
  partBoxes(re) {
    const r = this.renderer.domElement.getBoundingClientRect()
    const out = []
    for (const f of this.figures.values()) {
      const parts = f.parts
      if (!parts) continue
      parts.model.updateWorldMatrix(true, false)
      for (const { name, box } of parts.boxes) {
        if (!re.test(name)) continue
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let i = 0; i < 8; i++) {
          const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
          parts.model.localToWorld(p).project(this.camera)
          const px = r.left + ((p.x + 1) / 2) * r.width
          const py = r.top + ((1 - p.y) / 2) * r.height
          x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py)
        }
        // Clipped to the canvas: a part off screen is pointed at where it leaves it.
        x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom)
        if (x1 > x0 && y1 > y0) out.push({ name, x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      }
    }
    return out
  }

  // The board's screen as a picture, top row first, for a journey's magnifier:
  // an ImageData, or null when no board has a screen.
  screenImage() {
    for (const f of this.figures.values()) if (f.screenImage) return f.screenImage()
    return null
  }

  // Where the middle of the rotation arrow for `axis` ('x' or 'y') is on the
  // page, for the tests: { x, y }.
  arrowPoint(axis) {
    const p = this._tiltFigure()?.arrowCentre(axis)
    if (!p) return null
    p.project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
  }

  fullScreen() {
    const f = this.host.requestFullscreen?.() ?? this.host.webkitRequestFullscreen?.()
    Promise.resolve(f).then(() => this.renderer.domElement.focus()).catch(() => {})
  }

  // A key of the board's (true if it was one), or F for full screen.
  _buttonKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (this.buttons.fullScreen && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      if (e.type !== 'keydown') return true
      if (document.fullscreenElement === this.host) document.exitFullscreen?.(); else this.fullScreen()
      return true
    }
    const tilt = this.buttons.onTilt && (e.key === 'Home' ? [null, null] : e.shiftKey && TILT_KEYS[e.key])
    if (tilt) {
      e.preventDefault()
      if (e.type !== 'keydown') return true
      const [x, y] = this._tiltIs()
      this._tilt(tilt[0] === null ? 0 : x + tilt[0], tilt[1] === null ? 0 : y + tilt[1])
      return true
    }
    const n = this.buttons.keys[e.key]
    if (n === undefined) return false
    e.preventDefault()
    if (!(e.type === 'keydown' && e.repeat)) this._press(n, e.type === 'keydown')
    return true
  }

  _press(n, down) {
    if (down === this.down.has(n)) return
    if (down) this.down.add(n); else this.down.delete(n)
    this.buttons.onButton(n, down)
  }

  // the figure that tilts (CodeX), or null
  _tiltFigure() {
    for (const f of this.figures.values()) if (f.arrowAt) return f
    return null
  }

  // Ask for a tilt, within the board's reach either way.
  _tilt(x, y) {
    const lim = (v) => Math.max(-TILT_MAX, Math.min(TILT_MAX, v))
    this._tiltAsked = [lim(x), lim(y)]
    this.buttons.onTilt(...this._tiltAsked)
  }

  // The tilt to step from: the last one asked for (keys come faster than
  // the world's frames), else the board's as drawn.
  _tiltIs() {
    return this._tiltAsked ?? this._tiltFigure()?.tiltNow ?? [0, 0]
  }

  _releaseAll() {
    for (const n of [...this.down]) this._press(n, false)
  }

  // A click on a key presses it while held, and a drag on a rotation arrow
  // tilts the board (both before the camera sees them, so it does not turn);
  // over a key the pointer shows a hand, over an arrow a grip.
  _bindPointer(canvas) {
    const ray = new THREE.Raycaster()
    const aim = (e) => {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      return ray
    }
    const keyAt = (e) => {
      aim(e)
      for (const f of this.figures.values()) {
        const n = f.keyAt?.(ray) ?? -1
        if (n !== -1) return n            // a button's number, or 'reset'
      }
      return -1
    }
    const arrowAt = (e) => (this.buttons.onTilt && this._tiltFigure()?.arrowAt(aim(e))) || null
    let held = null                 // { id, n } a key, or { id, axis, x, y, from } an arrow
    // A click (not a drag that turns the camera) names the part it lands on:
    // `onPick(name)`, by the CAD's name for it (parts.js), for mission packs.
    let press = null                // { id, x, y, at } where the last press began
    canvas.addEventListener('pointerup', (e) => {
      const p = press
      press = null
      if (!p || p.id !== e.pointerId || !this.onPick) return
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.at > 600) return
      aim(e)
      for (const f of this.figures.values()) {
        const name = f.partAt?.(ray)
        if (name) return this.onPick(name)
      }
    })
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() }
      if (e.button !== 0 || held) return
      const axis = arrowAt(e)
      const n = axis ? -1 : keyAt(e)
      if (!axis && n === -1) return
      e.stopImmediatePropagation()
      e.preventDefault()
      canvas.focus()
      canvas.setPointerCapture?.(e.pointerId)
      if (axis) {
        held = { id: e.pointerId, axis, x: e.clientX, y: e.clientY, from: [...this._tiltIs()] }
        canvas.style.cursor = 'grabbing'
        return
      }
      held = { id: e.pointerId, n }
      this._press(n, true)
    }, { capture: true })
    const up = (e) => {
      if (!held || e.pointerId !== held.id) return
      if (held.axis) canvas.style.cursor = 'grab'
      else this._press(held.n, false)
      held = null
    }
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointermove', (e) => {
      if (held?.axis && e.pointerId === held.id) {
        // the arc under the board goes with a sideways drag, the one at its
        // right with an up and down one (right or down: that edge away)
        const [x, y] = held.from
        if (held.axis === 'x') this._tilt(x + (e.clientX - held.x) * TILT_PER_PX, y)
        else this._tilt(x, y + (e.clientY - held.y) * TILT_PER_PX)
        return
      }
      if (held || e.buttons !== 0) return
      const axis = arrowAt(e)
      this._tiltFigure()?.hotArrow(axis)
      this._touch()
      canvas.style.cursor = axis ? 'grab' : keyAt(e) !== -1 ? 'pointer' : ''
    })
  }

  // A snapshot from the world: { t, devices: [...] }.
  push(frame) {
    const at = performance.now()
    this.frames = [this.frames[1], { frame, at }]
    // The recent snapshots, by simulated time, for drawing (_current). A world
    // started over (time going back) or a device more or fewer starts afresh.
    const last = this._snaps[this._snaps.length - 1]
    if (last && (frame.t < last.t || frame.devices.length !== last.devices.length)) this._snaps = []
    if (!last || frame.t !== last.t) this._snaps.push({ t: frame.t, at, devices: frame.devices })
    if (this._snaps.length > SNAPS) this._snaps.shift()
    // Frames keep coming while nothing moves; only a change needs drawing.
    const key = JSON.stringify(frame.devices)
    if (key !== this._lastKey) { this._lastKey = key; this._touch() }
  }

  _touch() {
    this._changedAt = performance.now()
  }

  // A camera (camera-rig.js), at its home; again, back to its home.
  setCamera(mode, opts) {
    this._touch()
    const s = this.frames[1]?.frame.devices[0]
    if (s && s.x === undefined) return        // a board that stays put keeps its camera
    this.rig.setMode(mode, opts)
    if (!s) return
    this._placeCamera(s, true)
  }

  get cameraMode() {
    return this.rig.mode
  }

  // Size the drawing to the view's box. Giving a canvas a size clears it, even
  // the size it has, and the browser paints the cleared canvas unless it is
  // drawn again first: so nothing happens at the size already drawn, and a
  // new size is drawn at once, before the frame is painted (the view called
  // from a ResizeObserver or a drag), not on a later animation frame. Otherwise
  // the view flashes empty while its window is resized.
  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1
    const size = `${w}x${h}@${this.renderer.getPixelRatio()}`
    if (size === this._size) return
    this._size = size
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this._touch()
    if (this.host.isConnected && this.host.clientWidth) this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    removeEventListener('keydown', this._onTunerKey)
    tuner.close()
    settings.removeEventListener('change', this._onSettings)
    cancelAnimationFrame(this._raf)
    this._resize.disconnect()
    this.controls.dispose()
    this._studioTex?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // Draw the device where it was at the playout clock: a simulated time a
  // little behind the newest snapshot, which runs on smoothly at the
  // simulation's pace, between the two snapshots either side of it. The
  // snapshots come from the worker about every 16 ms of wall clock, but
  // unevenly, and a frame of the screen may see none or two; drawn by when
  // each arrived, a robot driving steadily sped up and stalled by turns (and
  // the chase camera, following it, made the whole room lurch). Drawn on a
  // clock of its own, it moves as steadily as it was simulated.
  //   behind  two snapshots' worth of simulated time: the next is nearly
  //           always in hand
  //   pace    simulated time a wall millisecond, measured over the snapshots
  //           held; the clock is steered gently toward its place behind the
  //           newest (PLAY_STEER a second), so it neither drifts nor jumps
  //   jump    a clock more than PLAY_JUMP snapshots out (a pause, a reset, a
  //           slow page) goes straight to its place
  _current(dt) {
    const snaps = this._snaps
    const newest = snaps[snaps.length - 1]
    if (!newest) return null
    if (snaps.length < 2) return newest.devices
    const first = snaps[0]
    const pace = newest.at > first.at ? (newest.t - first.t) / (newest.at - first.at) : 1000
    const gap = (newest.t - first.t) / (snaps.length - 1)
    const want = newest.t - 2 * gap
    let t = this._play ?? want
    t += pace * 1000 * Math.min(dt, 0.1)
    t += (want - t) * Math.min(1, PLAY_STEER * dt)
    if (Math.abs(want - t) > PLAY_JUMP * gap) t = want
    t = Math.min(newest.t, Math.max(first.t, t))
    this._play = t
    let i = snaps.length - 1
    while (i > 0 && snaps[i - 1].t > t) i--
    const a = snaps[Math.max(0, i - 1)], b = snaps[i]
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1
    return b.devices.map((d, k) => lerpSnap(a.devices[k], d, f))
  }

  _placeCamera(s, jump, dt = 0) {
    this.rig.place(s, jump, dt)
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop)
    const dt = this._lastLoop ? (now - this._lastLoop) / 1000 : 0
    this._lastLoop = now
    if (!this.host.isConnected || this.host.clientWidth === 0) return
    const devices = this._current(dt)
    // a board that stays put (CodeX): the camera is the student's
    if (devices) {
      for (const s of devices) this.figures.get(s.id)?.update(s)
      if (devices[0].x !== undefined) this._placeCamera(devices[0], false, dt)
    }
    if (this.rig.update(dt)) this._touch()
    const moved = this.rig.controls.enabled && this.controls.update()
    // Draw while things move, and a while after (the picture eases to rest:
    // interpolation, the chase camera); then rest, and leave the CPU to the
    // program.
    now = performance.now()
    if (!moved && now - this._changedAt > SETTLE_MS) { this._gov.last = 0; this.fps = null; return }
    // the level's frame cap: a frame comes no sooner than its share of a second
    const cap = PRESETS[this.level].fps
    if (cap && this._gov.drawn && now - this._gov.drawn < 1000 / cap - 4) return
    this._gov.drawn = now
    // the near plane follows the camera in, so a close look at a board's
    // parts is not cut away, and stays as far out as it may for depth
    const near = Math.min(0.01, Math.max(0.001, this.camera.position.distanceTo(this.controls.target) * 0.1))
    if (near !== this.camera.near) { this.camera.near = near; this.camera.updateProjectionMatrix() }
    this.renderer.render(this.scene, this.camera)
    this._govern(now)
  }

  // Every second of continuous drawing: the frame rate, for the settings
  // panel, and under Auto the level it calls for.
  _govern(now) {
    const g = this._gov
    if (g.last) { g.sum += now - g.last; g.n++ }
    g.last = now
    if (g.sum < 1000) return
    this.fps = (1000 * g.n) / g.sum
    g.sum = 0; g.n = 0
    if (settings.realism !== 'auto') return
    const level = this.auto.measure(this.fps)
    if (level === this.level) return
    this.level = level
    settings.setAutoLevel(level)
    this._realism()
  }

  // Draw at the level chosen: pixels, shadows, glow, texture sharpness.
  _realism() {
    if (settings.realism !== 'auto') this.level = settings.realism
    const p = PRESETS[this.level]
    const ratio = Math.min(p.ratio, globalThis.devicePixelRatio || 1)
    if (ratio !== this.ratio) {
      this.ratio = ratio
      this.renderer.setPixelRatio(ratio)
      if (this.camera) this.resize()
    }
    this.scene?.traverse((o) => {
      if (o.userData.realism) o.visible = p[o.userData.realism]
      const map = o.isMesh && o.material?.map
      if (map && map.anisotropy !== p.anisotropy) { map.anisotropy = p.anisotropy; map.needsUpdate = true }
    })
    this._touch()
  }
}

const SETTLE_MS = 1500

// The playout clock (_current): snapshots held (about half a second's), how
// fast the clock is steered to its place (a second), how far out it may be
// before it jumps there (in snapshots).
const SNAPS = 30
const PLAY_STEER = 2
const PLAY_JUMP = 15

// Tilting: a drag's radians a pixel; Shift and an arrow key's step (5 degrees)
// as [x, y], x the right edge down, y the bottom edge down.
const TILT_PER_PX = 0.01
const STEP = Math.PI / 36
const TILT_KEYS = { ArrowRight: [STEP, 0], ArrowLeft: [-STEP, 0], ArrowDown: [0, STEP], ArrowUp: [0, -STEP] }

function lerpSnap(a, b, f) {
  let dh = b.heading - a.heading
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  const L = (k) => (b[k] === undefined || a[k] === undefined ? b[k] : a[k] + (b[k] - a[k]) * f)
  return {
    ...b,
    x: L('x'), y: L('y'), z: L('z'), above: L('above'), roll: L('roll'), pitch: L('pitch'), propAngle: L('propAngle'),
    heading: a.heading + dh * f,
    wheelAngle: b.wheelAngle && a.wheelAngle ? b.wheelAngle.map((w, i) => a.wheelAngle[i] + (w - a.wheelAngle[i]) * f) : b.wheelAngle,
  }
}
