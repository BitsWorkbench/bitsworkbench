// CodeX as drawn: its model standing in the showroom, as CodeSpace's
// simulator shows it, with its screen, LEDs and NeoPixels lit from the
// snapshot and its keys pressed down while held.
//
// The model (codex.glb, built from sim/assets/CodeX.glb) is in millimetres,
// face up (+y), the top of the board toward -z, its right toward +x. The
// figure stands it up facing the camera (+z): face to +z, top to +y. The
// figure's root is the board's centre, 10 cm above the floor.
//
// Tilt: the face-on view stands for looking down at the board, so the
// accelerometer reads flat (world/codex.js gravity()) while it faces the
// camera square. Tilted, its right edge (tiltX) or its bottom edge (tiltY)
// turns away from the camera, as that edge going down would look from above.
// Two rotation arrows beside the board (an arc under it for tiltX, one at its
// right for tiltY) are what a drag tilts it by; they stay put as it turns.
import * as THREE from 'three'
import { Light, glowSprite, neoPixel } from './led.js'
import { Keys } from './keys.js'

export const CODEX_HEIGHT = 0.10    // m, the board's centre above the floor

// Keys as the program numbers them (BTN_U .. BTN_B = 0 .. 5), and the
// keyboard's keys for them while the view has focus.
const KEYS_BY_NAME = ['BTN_U', 'BTN_R', 'BTN_D', 'BTN_L', 'BTN_A', 'BTN_B']
export const CODEX_KEYS = {
  ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
  a: 4, A: 4, z: 4, Z: 4, b: 5, B: 5, x: 5, X: 5,
}
const KEY_TRAVEL = 0.5              // mm a key goes down when pressed
const KEY_REACH = 4.5               // mm, the radius a click finds a key within

// The display: 240 x 240 pixels on a 1.54 inch panel, 27.72 mm square: the
// model's active area (LCD_Active; sim/tools/build-models.mjs names it).
const PIXELS = 240
const ACTIVE_MM = 27.72

// The six red LEDs: 0 to 3 in a row under the screen (the model's LED_0 to
// LED_3), and B and A (4 and 5) by the diode marks above their keys, where
// the model has none: drawn as copies of LED_0, in model millimetres.
const LED_AB = { 4: [34.6, -10.4], 5: [24.6, -10.4] }
const LED_RED = new THREE.Color(1, 0.07, 0.03)

// The rotation arrows: arcs of this radius (m), a tenth of a turn long and
// bowed a little toward the camera, an arrowhead at each end, the showroom
// grid's teal.
const ARROW_R = 0.12
const ARROW_SPAN = Math.PI / 10           // either way from the middle
const ARROW_COLOR = new THREE.Color().setRGB(0, 0.75, 0.75, THREE.SRGBColorSpace)
const ARROW_HOT = new THREE.Color().setRGB(0.4, 1, 1, THREE.SRGBColorSpace)
export const TILT_MAX = Math.PI / 2       // either way, from flat

export class CodeXFigure {
  constructor() {
    this.root = new THREE.Group()
    this.root.position.y = CODEX_HEIGHT
    this.tilt = new THREE.Group()           // turned by the board's tilt
    this.root.add(this.tilt)
    this.body = new THREE.Group()
    this.body.scale.setScalar(0.001)
    this.body.rotation.x = Math.PI / 2      // face up to face front, top to up
    this.tilt.add(this.body)
    this.tiltNow = [0, 0]                   // [x, y], radians, from the snapshot
    this.arrows = []                        // { axis, mat, target }, after load
    this.keys = new Keys()                  // by number, a click presses them
    this.leds = []                          // by number: each a Light (led.js)
    this.pixels = []                        // NeoPixels 0 to 3: each a Light
  }

  async load(loader, base) {
    const gltf = await loader.loadAsync(`${base}models/codex.glb`)
    const model = gltf.scene
    this.body.add(model)
    this.root.updateMatrixWorld(true)
    const node = (name) => model.getObjectByName(name)

    model.traverse((o) => {
      if (!o.isMesh) return
      // The screen's glass: see-through without a second render pass.
      for (const m of [o.material].flat()) {
        if (m.transmission > 0) {
          o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false })
        }
      }
    })

    // The keys: their normals face inward, so they shade flat (normals from
    // the surface as drawn); a click presses them (keys.js).
    KEYS_BY_NAME.forEach((name, n) => {
      const mesh = node(name)
      mesh.material = mesh.material.clone()
      mesh.material.flatShading = true
      this.keys.add(n, [mesh], { reach: KEY_REACH, travel: KEY_TRAVEL })
    })
    // Reset, on the back by the power switch: pressed where it can be seen,
    // never through the board (the model hides it).
    this.keys.model = model
    this.keys.add('reset', [node('ResetButton')], { reach: KEY_REACH, travel: -KEY_TRAVEL })

    // LEDs 0 to 3, and B and A copied from LED_0.
    const led0 = node('LED_0')
    for (let n = 0; n < 6; n++) {
      let mesh = node(`LED_${n}`)
      if (!mesh) {
        mesh = led0.clone()
        const [x, z] = LED_AB[n]
        // the copy's mesh is centred elsewhere: move its centre to the mark
        const c = centre(led0)
        mesh.position.add(new THREE.Vector3(x - c.x, 0, z - c.z))
        model.add(mesh)
      }
      this.leds[n] = this._light(mesh, 7)
    }
    // the NeoPixels lit in the cup in each one's top (led.js)
    for (let n = 0; n < 4; n++) {
      const part = node(`Neo_${n}`)
      this.pixels[n] = neoPixel(part.parent, part)
    }

    // The screen: a texture of the program's pixels over the active area,
    // drawn as the backlight lights it.
    const area = new THREE.Box3().setFromObject(node('LCD_Active'))
    const local = area.clone().applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert())
    this.screenData = new Uint8Array(PIXELS * PIXELS * 4)
    this.screenTex = new THREE.DataTexture(this.screenData, PIXELS, PIXELS)
    this.screenTex.colorSpace = THREE.SRGBColorSpace
    this.screenTex.magFilter = THREE.NearestFilter
    this.screenTex.minFilter = THREE.LinearMipmapLinearFilter
    this.screenTex.generateMipmaps = true
    this.screenTex.needsUpdate = true
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(ACTIVE_MM, ACTIVE_MM),
      new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }),
    )
    this.screen.rotation.x = -Math.PI / 2   // facing up (+y), its top toward -z
    const mid = local.getCenter(new THREE.Vector3())
    this.screen.position.set(mid.x, local.max.y + 0.02, mid.z)
    this.screen.visible = false
    model.add(this.screen)

    // Centre the board on the root.
    this.body.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(this.body)
    const c = box.getCenter(new THREE.Vector3()).sub(this.root.getWorldPosition(new THREE.Vector3()))
    this.body.position.sub(c)
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    this._arrow('x', half.y + 0.012)
    this._arrow('y', half.x + 0.012)
  }

  // A rotation arrow: for tiltX an arc under the board, bowed toward the
  // camera (a turn about the upright); for tiltY one at its right (a turn about
  // the level). `off` is how far from the board's centre it runs.
  _arrow(axis, off) {
    const R = ARROW_R, span = ARROW_SPAN
    const at = (a) => {
      const along = R * Math.sin(a), toward = R * Math.cos(a) - R + 0.012
      return axis === 'x' ? new THREE.Vector3(along, -off, toward) : new THREE.Vector3(off, along, toward)
    }
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => at(-span + (2 * span * i) / 16)))
    const mat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, toneMapped: false })
    const group = new THREE.Group()
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.0012, 8), mat))
    for (const end of [0, 1]) {
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.0035, 0.008, 12), mat)
      const tangent = curve.getTangentAt(end).multiplyScalar(end ? 1 : -1)
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
      head.position.copy(curve.getPointAt(end)).addScaledVector(tangent, 0.003)
      group.add(head)
    }
    // a wider, unseen tube to grab it by
    const target = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.007, 6), new THREE.MeshBasicMaterial({ visible: false }))
    target.userData.axis = axis
    group.add(target)
    this.root.add(group)
    this.arrows.push({ axis, mat, target })
  }

  // The arrow a ray meets ('x' or 'y'), or null.
  arrowAt(raycaster) {
    const hit = raycaster.intersectObjects(this.arrows.map((a) => a.target), false)[0]
    return hit ? hit.object.userData.axis : null
  }

  // An arrow lit while the pointer is over it or drags it (null: neither).
  hotArrow(axis) {
    for (const a of this.arrows) a.mat.color.copy(a.axis === axis ? ARROW_HOT : ARROW_COLOR)
  }

  // Where arrow `axis`'s middle is in the world, for the tests.
  arrowCentre(axis) {
    const a = this.arrows.find((r) => r.axis === axis)
    if (!a) return null
    const mid = a.target.geometry.parameters.path.getPointAt(0.5)
    return a.target.localToWorld(mid)
  }

  // A light on the board: the part itself lit in the program's colour (its
  // own material, the look in led.js), and a glow over it (`glow` mm
  // across) that shows at a distance.
  _light(mesh, glow) {
    const mat = mesh.material.clone()
    mesh.material = mat
    const halo = glowSprite(glow)
    halo.position.copy(centre(mesh)).add(new THREE.Vector3(0, 1.2, 0))
    mesh.parent.add(halo)
    return new Light(mat, halo)
  }

  // Where the camera starts: in front, a little to the right and above, as
  // CodeSpace's showroom camera looks, near enough for the board and its
  // rotation arrows (`size` across, a little right of its centre for the
  // arrow there) to fill the view and its screen to be read.
  home() {
    return {
      target: new THREE.Vector3(0.008, CODEX_HEIGHT - 0.006, 0),
      from: new THREE.Vector3(0.3, 0.2, 1).normalize(),
      size: 0.18,
      minDistance: 0.05,
    }
  }

  // Key n's centre in the world.
  keyCentre(n) {
    return this.keys.keyCentre(n)
  }

  // The key a ray meets, or -1.
  keyAt(raycaster) {
    return this.keys.keyAt(raycaster)
  }

  // A new picture for the screen: RGB565 pixels, top row first.
  screenPixels(px) {
    const d = this.screenData
    for (let y = 0; y < PIXELS; y++) {
      // the texture's first row is the bottom of the picture
      let o = (PIXELS - 1 - y) * PIXELS * 4
      for (let x = 0; x < PIXELS; x++, o += 4) {
        const c = px[y * PIXELS + x]
        const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f
        d[o] = (r << 3) | (r >> 2)
        d[o + 1] = (g << 2) | (g >> 4)
        d[o + 2] = (b << 3) | (b >> 2)
        d[o + 3] = 255
      }
    }
    this.screenTex.needsUpdate = true
  }

  // The screen's colour at (x, y) as drawn, before the backlight: [r, g, b].
  screenRGB(x, y) {
    const o = ((PIXELS - 1 - y) * PIXELS + x) * 4
    return [this.screenData[o], this.screenData[o + 1], this.screenData[o + 2]]
  }

  update(s) {
    // the board as tilted (see the top of this file)
    if (s.tilt) {
      this.tiltNow = s.tilt
      this.tilt.rotation.set(s.tilt[1], s.tilt[0], 0)
    }
    // the backlight: off shows the panel itself
    this.screen.visible = s.brightness > 0
    this.screen.material.color.setScalar(Math.min(1, Math.max(0.05, s.brightness / 100)))
    s.leds?.forEach((on, n) => {
      const l = this.leds[n]
      if (!l) return
      l.show(LED_RED, on ? 1 : 0)
    })
    s.pixels?.forEach(([r, g, b], n) => this.pixels[n]?.rgb(r, g, b))
    if (s.buttons) this.keys.show((n) => (n === 'reset' ? s.reset : s.buttons[n]))
  }
}

// A mesh's centre, in its parent's frame.
function centre(mesh) {
  mesh.updateMatrix()
  mesh.geometry.computeBoundingBox()
  return mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrix)
}
