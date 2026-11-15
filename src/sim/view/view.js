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
import { CodeXFigure } from './codex-figure.js'
import { courseMesh } from './course-mesh.js'
import { PRESETS, AutoRealism } from './realism.js'
import { settings } from '../settings.js'

const FIGURES = { codebot: CodeBotFigure, codeair: CodeAIRFigure, codex: CodeXFigure }
const SKY = 0xdfe8ef

export class SimView {
  // `buttons`, for a board whose keys the view presses (CodeX): { keys, onButton },
  // keys from KeyboardEvent.key to a button's number, onButton(n, down). Its
  // keys are then pressed by the keyboard (F goes full screen) and by a click
  // on the model, and the arrow keys no longer turn the camera.
  constructor(host, { assetsBase, buttons = null }) {
    this.host = host
    this.assetsBase = assetsBase
    this.buttons = buttons
    this.down = new Set()
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    this.figures = new Map()
    this.frames = [null, null]      // the two latest snapshots, with arrival times
    this.cameraMode = 'chase'

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
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 0.12
    this.controls.maxDistance = 30
    this.controls.addEventListener('start', () => { if (this.cameraMode === 'chase') { this.cameraMode = 'orbit'; this.onCameraMode?.('orbit') } })
    this.controls.addEventListener('change', () => this._touch())
    // The keyboard, with the view focused: left and right go round the
    // board, up and down look from higher or lower, + and - go nearer and
    // farther. Any of them takes the camera into orbit, as a drag does.
    const canvas = r.domElement
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + -')
    canvas.addEventListener('keydown', (e) => {
      if (this.buttons && this._buttonKey(e)) return
      const turn = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key]
      const zoom = { '+': 0.8, '=': 0.8, '-': 1.25, _: 1.25 }[e.key]
      if (!turn && !zoom) return
      e.preventDefault()
      if (this.cameraMode !== 'orbit') { this.cameraMode = 'orbit'; this.onCameraMode?.('orbit') }
      const c = this.controls
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(c.target))
      if (turn) {
        s.theta += turn[0]
        s.phi = Math.min(c.maxPolarAngle, Math.max(0.05, s.phi + turn[1]))
      } else {
        s.radius = Math.min(c.maxDistance, Math.max(c.minDistance, s.radius * zoom))
      }
      this.camera.position.setFromSpherical(s).add(c.target)
      this._touch()
    })
    if (buttons) {
      canvas.addEventListener('keyup', (e) => this._buttonKey(e))
      canvas.addEventListener('blur', () => this._releaseAll())
      this._bindPointer(canvas)
    }
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

  // Studio light for the showroom's metal and glass to reflect: three's
  // RoomEnvironment, made once.
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
    await fig.load(this.loader, this.assetsBase)
    this.scene.add(fig.root)
    this.figures.set(snap.id, fig)
    this._realism()
    this._touch()
    fig.update(snap)
    if (fig.home) {
      // a board that stays put: the camera starts where the figure says, in orbit
      // (from a direction, near enough for its size to fit the view's narrower way)
      const h = fig.home()
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect))
      this.cameraMode = 'orbit'
      this.controls.target.copy(h.target)
      this.camera.position.copy(h.target).addScaledVector(h.from, (h.size * 0.55) / Math.tan(half))
      this.controls.minDistance = h.minDistance
    } else {
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

  fullScreen() {
    const f = this.host.requestFullscreen?.() ?? this.host.webkitRequestFullscreen?.()
    Promise.resolve(f).then(() => this.renderer.domElement.focus()).catch(() => {})
  }

  // A key of the board's (true if it was one), or F for full screen.
  _buttonKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      if (e.type !== 'keydown') return true
      if (document.fullscreenElement === this.host) document.exitFullscreen?.(); else this.fullScreen()
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

  _releaseAll() {
    for (const n of [...this.down]) this._press(n, false)
  }

  // A click on a key presses it while held (before the camera sees it, so it
  // does not turn); over a key the pointer shows a hand.
  _bindPointer(canvas) {
    const ray = new THREE.Raycaster()
    const keyAt = (e) => {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      for (const f of this.figures.values()) {
        const n = f.keyAt?.(ray) ?? -1
        if (n >= 0) return n
      }
      return -1
    }
    let held = null                 // { id, n }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || held) return
      const n = keyAt(e)
      if (n < 0) return
      e.stopImmediatePropagation()
      e.preventDefault()
      canvas.focus()
      canvas.setPointerCapture?.(e.pointerId)
      held = { id: e.pointerId, n }
      this._press(n, true)
    }, { capture: true })
    const up = (e) => {
      if (!held || e.pointerId !== held.id) return
      this._press(held.n, false)
      held = null
    }
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointermove', (e) => {
      if (!held && e.buttons === 0) canvas.style.cursor = keyAt(e) >= 0 ? 'pointer' : ''
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

  setCamera(mode) {
    this._touch()
    const s = this.frames[1]?.frame.devices[0]
    if (s && s.x === undefined) return        // a board that stays put keeps its camera
    this.cameraMode = mode
    if (!s) return
    this._placeCamera(s, true)
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this._touch()
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
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
    const target = new THREE.Vector3(s.x, (s.z ?? 0) + 0.04, -s.y)
    if (this.cameraMode === 'top') {
      this.camera.position.set(s.x, 2.2 + (s.z ?? 0), -s.y + 0.001)
      this.controls.target.copy(target)
    } else if (this.cameraMode === 'chase') {
      const back = new THREE.Vector3(-Math.cos(s.heading), 0, Math.sin(s.heading)).multiplyScalar(0.45)
      const want = target.clone().add(back).add(new THREE.Vector3(0, 0.28, 0))
      if (jump) this.camera.position.copy(want)
      else this.camera.position.lerp(want, 0.08)
      this.controls.target.lerp(target, jump ? 1 : 0.2)
    } else if (jump) {
      this.controls.target.copy(target)
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop)
    if (!this.host.isConnected || this.host.clientWidth === 0) return
    const devices = this._current()
    if (devices) {
      for (const s of devices) this.figures.get(s.id)?.update(s)
      if (devices[0].x === undefined) {
        // a board that stays put (CodeX): the camera is the student's
      } else if (this.cameraMode !== 'orbit') this._placeCamera(devices[0], false)
      else {
        // Orbit follows the robot without fighting the student's drag.
        const t = new THREE.Vector3(devices[0].x, (devices[0].z ?? 0) + 0.04, -devices[0].y)
        const d = t.clone().sub(this.controls.target)
        this.controls.target.add(d)
        this.camera.position.add(d)
      }
    }
    const moved = this.controls.update()
    // Draw while things move, and a while after (the picture eases to rest:
    // interpolation, the chase camera); then rest, and leave the CPU to the
    // program.
    const now = performance.now()
    if (!moved && now - this._changedAt > SETTLE_MS) { this._gov.last = 0; this.fps = null; return }
    // the level's frame cap: a frame comes no sooner than its share of a second
    const cap = PRESETS[this.level].fps
    if (cap && this._gov.drawn && now - this._gov.drawn < 1000 / cap - 4) return
    this._gov.drawn = now
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
