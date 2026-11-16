// CodeBot as drawn: the CB3 body and wheels, its LEDs lit from the snapshot,
// and a soft shadow under it.
//
// The body model is in 10 cm units, front toward +z, left toward +x; the axle
// and the resting tilt are the world model's (CB3_BODY). The figure's root
// sits at the world pose: the axle's midpoint on the floor, facing +x.
import * as THREE from 'three'
import { CB3_BODY, CB3_PITCH } from '../world/codebot.js'
import { Led, reflect } from './led.js'
import { Keys } from './keys.js'

const U = 0.1                 // model units to metres
const AXLE_Z = CB3_BODY.axle[0] / 100    // model units
const AXLE_Y = CB3_BODY.axle[1] / 100
const WHEEL_R = CB3_BODY.tyreRadius / 1000
const TRACK = 0.111
const PITCH = CB3_PITCH       // rad, front down to the skid
// The main board's top face in model units (the model's board is 1.75 mm
// thick, centred 0.94 mm below the model's origin), and an LED's height, m.
const BOARD_TOP = -0.0007
const LED_H = 0.001

// LED positions in model units (x left, z forward), from the CB3 layout as
// CodeSpace's simulator has it: user LED 0 at the left, under its 0; the
// battery LED beside the power switch.
const USER = [18.9, 13.8, 8.7, 3.6, -3.6, -8.7, -13.8, -18.9].map((x) => [x / 100, 0.023])
const LS = [19.1, 9.7, 0, -9.7, -19.1].map((x) => [x / 100, 0.61])
const PROX = [[0.358, 0.596], [-0.358, 0.596]]
const PWR = [0.333, -0.386]
// The CB3's colours: red user LEDs, green line sensor and battery LEDs, and
// CodeSpace's amber for the proximity emitters.
const RED = 0xff1a10, GREEN = 0x22ff33, AMBER = 0xffb040

export class CodeBotFigure {
  constructor() {
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()          // pitched about the axle
    this.root.add(this.tilt)
    this.tilt.position.y = WHEEL_R
    this.tilt.rotation.z = -PITCH
    this.leds = { user: [], ls: [], prox: [], pwr: [] }
    this.keys = new Keys()
  }

  // Button n's centre in the world; the button a ray meets, or -1 (view.js).
  keyCentre(n) { return this.keys.keyCentre(n) }
  keyAt(raycaster) { return this.keys.keyAt(raycaster) }

  // env: studio light for the metal to reflect (view.js)
  async load(loader, base, env) {
    const [body, wheel] = await Promise.all([
      loader.loadAsync(`${base}models/codebot-body.glb`),
      loader.loadAsync(`${base}models/codebot-wheel.glb`),
    ])
    const b = body.scene
    b.scale.setScalar(U)
    // Model forward (+z) to the figure's forward (+x); axle to the origin.
    b.rotation.y = Math.PI / 2
    b.position.set(-AXLE_Z * U, -AXLE_Y * U, 0)
    this.tilt.add(b)

    this.wheels = [1, -1].map((side) => {
      const w = wheel.scene.clone()
      w.scale.setScalar(U)
      const holder = new THREE.Group()
      holder.position.set(0, WHEEL_R, (-side * TRACK) / 2)
      // The wheel model's axis is its x; turn it to the figure's z (across).
      w.rotation.y = Math.PI / 2 * side
      holder.add(w)
      this.root.add(holder)
      return holder
    })

    reflect(b, env)
    reflect(wheel.scene, env)          // its clones share its materials
    // BTN-0 and BTN-1: a click presses them (keys.js), 0.5 mm down; never
    // through the robot, from below
    this.keys.model = b
    for (const n of [0, 1]) {
      this.keys.add(n, [b.getObjectByName(`BTN_${n}`), b.getObjectByName(`BTN_${n}_cap`)], { reach: 0.045, travel: 0.005 })
    }
    // A 0603 LED, 2 mm across by 1.4 mm, standing 1 mm on the board: its
    // base on the board's top face. Its glow is small and faint: the user
    // LEDs are 5.1 mm apart, and each stays its own light over the digits
    // printed beside it.
    const led = (group, x, z, color) => {
      // model (x left, z forward) to the body's frame after its rotation
      const at = new THREE.Vector3(z * U - AXLE_Z * U, (-AXLE_Y + BOARD_TOP) * U + LED_H / 2, -x * U)
      this.leds[group].push(new Led(this.tilt, at, [0.0014, LED_H, 0.002], color, 0.007, 1, { strength: 0.5 }))
    }
    USER.forEach(([x, z]) => led('user', x, z, RED))
    LS.forEach(([x, z]) => led('ls', x, z, GREEN))
    PROX.forEach(([x, z]) => led('prox', x, z, AMBER))
    led('pwr', PWR[0], PWR[1], GREEN)

    // A soft shadow, cheaper than a shadow map.
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.45)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.16),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0.045, 0.0015, 0)
    shadow.userData.realism = 'shadows'   // drawn at the levels that have them (realism.js)
    this.root.add(shadow)
  }

  update(s) {
    this.root.position.set(s.x, s.z ?? 0, -s.y)
    this.root.rotation.y = s.heading
    if (this.wheels && s.wheelAngle) {
      this.wheels[0].rotation.z = -s.wheelAngle[0]
      this.wheels[1].rotation.z = -s.wheelAngle[1]
    }
    const bits = (leds, v) => leds.forEach((l, i) => l.set((v >> i) & 1))
    bits(this.leds.user, s.leds.user)
    bits(this.leds.ls, s.leds.ls)
    bits(this.leds.prox, s.leds.prox)
    bits(this.leds.pwr, s.leds.pwr ? 1 : 0)
    if (s.buttons) this.keys.show((n) => s.buttons[n])
  }
}
