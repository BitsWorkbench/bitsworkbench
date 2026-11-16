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
import { PRESETS, AutoRealism } from './realism.js'
import { settings } from '../settings.js'

const FIGURES = { codebot: CodeBotFigure, codeair: CodeAIRFigure, codex: CodeXFigure }
const SKY = 0xdfe8ef
const ROBOT_CLOSEST = 0.12      // m, the nearest the camera comes to a robot

export class SimView {
  // `buttons`, for a board whose buttons the view presses (every board):
  // { keys, onButton, fullScreen }, keys from KeyboardEvent.key to a button's
  // number, onButton(n, down). Its buttons are then pressed by a click on the
  // model (the figure's keyAt, keys.js) and by those keys, which the camera
  // then no longer takes; with fullScreen, F goes full screen. With
  // `onTilt(x, y)` too (radians, world/codex.js tiltX and tiltY), a drag on
  // the figure's rotation arrows tilts the board, as do Shift and the arrow
  // keys (5 degrees a press); Home sets it level.
  constructor(host, { assetsBase, buttons = null }) {
    this.host = host
    this.assetsBase = assetsBase
    this.buttons = buttons
    this.down = new Set()
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    this.figures = new Map()
    this.frames = [null, null]      // the two latest snapshots, with arrival times

    // Realism (realism.js): chosen in the settings panel, or Auto, which
    // moves a level at a time from the frame rate it measures. A school
    // Chromebook's GPU gets fewer pixels and effects rather than fewer frames.
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
    const key = (e) => { if (!(this.buttons && this._buttonKey(e))) this.rig.key(e) }
    canvas.addEventListener('keydown', key)
    canvas.addEventListener('keyup', key)
    canvas.addEventListener('blur', () => { this._releaseAll(); this.rig.held.clear() })
    if (buttons) this._bindPointer(canvas)
    this._changedAt = 0           // when the picture last had reason to change

    this._resize = new ResizeObserver(() => this.resize())
    this._resize.observe(host)
    this.resize()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
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
    canvas.addEventListener('pointerdown', (e) => {
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
    this.frames = [this.frames[1], { frame, at: performance.now() }]
    // Frames keep coming while nothing moves; only a change needs drawing.
    const key = JSON.stringify(frame.devices)
    if (key !== this._lastKey) { this._lastKey = key; this._touch() }
  }

  _touch() {
    this._changedAt = performance.now()
  }

  // A camera (camera-rig.js), at its home; again, back to its home.
  setCamera(mode) {
    this._touch()
    const s = this.frames[1]?.frame.devices[0]
    if (s && s.x === undefined) return        // a board that stays put keeps its camera
    this.rig.setMode(mode)
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
    settings.removeEventListener('change', this._onSettings)
    cancelAnimationFrame(this._raf)
    this._resize.disconnect()
    this.controls.dispose()
    this._studioTex?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // Draw the device where it is now: between the last two snapshots, by how
  // far the wall clock has gone from one to the next.
  _current() {
    const [a, b] = this.frames
    if (!b) return null
    if (!a || a.frame.devices.length !== b.frame.devices.length) return b.frame.devices
    const span = b.at - a.at
    const f = span > 0 ? Math.min(1, (performance.now() - b.at) / span) : 1
    return b.frame.devices.map((d, i) => lerpSnap(a.frame.devices[i], d, f))
  }

  _placeCamera(s, jump) {
    this.rig.heading(s)
    this.rig.place(s, jump)
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop)
    const dt = this._lastLoop ? (now - this._lastLoop) / 1000 : 0
    this._lastLoop = now
    if (!this.host.isConnected || this.host.clientWidth === 0) return
    const devices = this._current()
    // a board that stays put (CodeX): the camera is the student's
    if (devices) {
      for (const s of devices) this.figures.get(s.id)?.update(s)
      if (devices[0].x !== undefined) this._placeCamera(devices[0], false)
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
