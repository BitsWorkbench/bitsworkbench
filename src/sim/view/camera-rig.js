// The 3D view's cameras, CodeSpace's four (its values, in metres):
//   rotate    turns round a point in the room, where the robot was when the
//             camera was chosen; drag to turn, wheel to zoom, right drag to slide
//   chase     follows behind the robot as it turns; drag to look from another
//             side or height, wheel to come nearer
//   universal flies freely: drag to look, the arrow keys or W A S D to move,
//             Q and E to go down and up, the wheel to go forward and back
//   attached  rides on the robot, looking where it goes
// The keyboard does the same with the view focused: arrows turn (rotate,
// chase) or move (universal), + and - zoom.
// The modes, in the menu's order, are kinds.js CAMERA_MODES.
import * as THREE from 'three'

// CodeSpace's home for each (its scene unit is 10 cm; z flipped for three's hands)
const ROTATE = { alpha: Math.PI * 0.8, beta: Math.PI / 2.5, radius: 0.4 }
const CHASE = { turn: 0, radius: 0.3, height: 0.2 }
// How chase eases after the robot (s): its place, its heading. A robot at
// full speed (about 0.4 m/s) is followed about 8 cm behind where it would sit.
const CHASE_EASE = { place: 0.2, heading: 0.35 }
const UNIVERSAL = new THREE.Vector3(0.5, 1.5, -0.5)
const ATTACHED = { back: 0.13, up: 0.05 }
const FLY_SPEED = 0.6            // m/s, universal's keys
const LOOK = 0.004               // radians a pixel, universal's drag

const UP = new THREE.Vector3(0, 1, 0)

// Where a snapshot's robot is, in the view (three's y up, the world's y as -z),
// and the way it faces.
// `aim`: how high above the floor under it the camera looks (m).
export function targetOf(s, aim = 0.04) {
  return new THREE.Vector3(s.x, (s.z ?? 0) + aim, -s.y)
}
const forwardOf = (s) => new THREE.Vector3(Math.cos(s.heading ?? 0), 0, -Math.sin(s.heading ?? 0))

export class CameraRig {
  // controls: the view's OrbitControls (rotate and chase use them)
  constructor(camera, controls, canvas, onMove) {
    this.camera = camera
    this.controls = controls
    this.onMove = onMove
    this.mode = 'rotate'
    this.chase = { ...CHASE }
    this.held = new Set()          // universal's movement keys held
    this._dragging = false
    this.aim = 0.04                // m above the robot's floor the cameras turn round (view.js)
    controls.addEventListener('start', () => { this._dragging = true })
    controls.addEventListener('end', () => { this._dragging = false })
    // a drag in chase moves where it chases from
    controls.addEventListener('change', () => { if (this._dragging && this.mode === 'chase') this._readChase() })
    this._bindLook(canvas)
  }

  // `turn`: for chase, degrees round from behind the robot it starts at (180
  // looks at its front).
  setMode(mode, { turn = null } = {}) {
    this.mode = mode
    this.chase = { ...CHASE, ...(turn === null ? {} : { turn: THREE.MathUtils.degToRad(turn) }) }
    this._follow = null
    this.held.clear()
    const orbit = mode === 'rotate' || mode === 'chase'
    this.controls.enabled = orbit
    this.controls.enableDamping = mode === 'rotate'
    this.controls.maxPolarAngle = 0.95 * Math.PI / 2
  }

  // The camera at its home for the robot at s (jump), or, `dt` seconds of
  // the screen on, where the mode wants it as the robot moves.
  place(s, jump, dt = 0) {
    const t = targetOf(s, this.aim)
    const c = this.controls
    if (this.mode === 'chase') return this._chase(s, t, jump, dt)
    if (this.mode === 'rotate') {
      if (!jump) return
      const { alpha, beta, radius } = ROTATE
      c.target.copy(t)
      this.camera.position.copy(t).add(new THREE.Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), -Math.sin(alpha) * Math.sin(beta)).multiplyScalar(radius))
    } else if (this.mode === 'universal') {
      if (!jump) return
      this.camera.position.copy(t).add(UNIVERSAL)
      this.camera.lookAt(t)
    } else {
      // behind the robot's middle, above its board (CodeSpace's robot is
      // centred there, as targetOf is), looking level
      const f = forwardOf(s)
      const base = targetOf(s).add(new THREE.Vector3(0, ATTACHED.up, 0))
      this.camera.position.copy(base).addScaledVector(f, -ATTACHED.back)
      this.camera.lookAt(base.addScaledVector(f, 1))
    }
  }

  // Each frame: fly while universal's keys are held. True if the camera moved.
  update(dt) {
    if (this.mode !== 'universal' || !this.held.size) return false
    const step = FLY_SPEED * Math.min(dt, 0.1)
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    const right = fwd.clone().cross(UP).normalize()
    const v = new THREE.Vector3()
    for (const k of this.held) {
      if (k === 'f') v.add(fwd)
      if (k === 'b') v.sub(fwd)
      if (k === 'r') v.add(right)
      if (k === 'l') v.sub(right)
      if (k === 'u') v.add(UP)
      if (k === 'd') v.sub(UP)
    }
    if (!v.lengthSq()) return false
    this.camera.position.addScaledVector(v.normalize(), step)
    return true
  }

  // A key on the focused view: true if the camera took it.
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (this.mode === 'universal') {
      const k = FLY_KEYS[e.key]
      if (!k) return false
      e.preventDefault()
      if (e.type === 'keydown') this.held.add(k); else this.held.delete(k)
      this.onMove()
      return true
    }
    if (e.type !== 'keydown' || this.mode === 'attached') return false
    const turn = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key]
    const zoom = { '+': 0.8, '=': 0.8, '-': 1.25, _: 1.25 }[e.key]
    if (!turn && !zoom) return false
    e.preventDefault()
    const c = this.controls
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(c.target))
    if (turn) {
      s.theta += turn[0]
      s.phi = Math.min(c.maxPolarAngle, Math.max(0.05, s.phi + turn[1]))
    } else {
      s.radius = Math.min(c.maxDistance, Math.max(c.minDistance, s.radius * zoom))
    }
    this.camera.position.setFromSpherical(s).add(c.target)
    if (this.mode === 'chase') this._readChase()
    this.onMove()
    return true
  }

  // the chase offsets from where the camera now is, relative to the robot's back
  _readChase() {
    const d = this.camera.position.clone().sub(this.controls.target)
    const back = this._backTheta ?? 0
    this.chase.height = d.y
    this.chase.radius = Math.hypot(d.x, d.z)
    this.chase.turn = Math.atan2(d.x, d.z) - back
  }

  // Chase, as a follow camera does it (Babylon.js's FollowCamera, Unity's
  // smooth follow): the robot's place and heading are eased toward, on the
  // screen's clock (`dt`, seconds since the last frame drawn), and the camera
  // sits rigidly at its offset from that eased pose, looking at it. One
  // easing, by time, not a fraction a frame: steady at any frame rate, and a
  // robot driving at a steady speed is followed at a steady distance, the
  // room gliding past rather than the camera and its aim catching up by
  // turns. A drag or a jump puts the eased pose on the robot.
  _chase(s, t, jump, dt) {
    const f = this._follow
    if (jump || this._dragging || !f) {
      this._follow = { at: t.clone(), heading: s.heading ?? 0 }
    } else {
      f.at.lerp(t, 1 - Math.exp(-dt / CHASE_EASE.place))
      let dh = (s.heading ?? 0) - f.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      f.heading += dh * (1 - Math.exp(-dt / CHASE_EASE.heading))
    }
    const { at, heading } = this._follow
    const back = forwardOf({ heading }).negate()
    this._backTheta = Math.atan2(back.x, back.z)
    back.applyAxisAngle(UP, this.chase.turn).multiplyScalar(this.chase.radius)
    this.controls.target.copy(at)
    this.camera.position.copy(at).add(back).add(new THREE.Vector3(0, this.chase.height, 0))
  }

  // universal: drag to look round, the wheel to go forward and back
  _bindLook(canvas) {
    let from = null
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'universal' || e.button !== 0) return
      from = { x: e.clientX, y: e.clientY, id: e.pointerId }
      canvas.setPointerCapture?.(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!from || e.pointerId !== from.id) return
      const r = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
      r.y -= (e.clientX - from.x) * LOOK
      r.x = Math.max(-1.5, Math.min(1.5, r.x - (e.clientY - from.y) * LOOK))
      r.z = 0
      this.camera.quaternion.setFromEuler(r)
      from.x = e.clientX
      from.y = e.clientY
      this.onMove()
    })
    const end = (e) => { if (from && e.pointerId === from.id) from = null }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    canvas.addEventListener('wheel', (e) => {
      if (this.mode !== 'universal') return
      e.preventDefault()
      const fwd = new THREE.Vector3()
      this.camera.getWorldDirection(fwd)
      this.camera.position.addScaledVector(fwd, -Math.sign(e.deltaY) * 0.1)
      this.onMove()
    }, { passive: false })
  }
}

const FLY_KEYS = {
  ArrowUp: 'f', w: 'f', W: 'f', ArrowDown: 'b', s: 'b', S: 'b',
  ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r',
  q: 'd', Q: 'd', e: 'u', E: 'u',
}
