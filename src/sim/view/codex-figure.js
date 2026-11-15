// CodeX as drawn: its model standing in the showroom, as CodeSpace's
// simulator shows it, with its screen, LEDs and NeoPixels lit from the
// snapshot and its keys pressed down while held.
//
// The model (codex.glb, built from sim/assets/CodeX.glb) is in millimetres,
// face up (+y), the top of the board toward -z, its right toward +x. The
// figure stands it up facing the camera (+z): face to +z, top to +y. The
// figure's root is the board's centre, 10 cm above the floor.
import * as THREE from 'three'
import { haloTexture } from './led.js'

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

export class CodeXFigure {
  constructor() {
    this.root = new THREE.Group()
    this.root.position.y = CODEX_HEIGHT
    this.body = new THREE.Group()
    this.body.scale.setScalar(0.001)
    this.body.rotation.x = Math.PI / 2      // face up to face front, top to up
    this.root.add(this.body)
    this.keys = []                          // by number: { mesh, rest }
    this.leds = []                          // by number: { mat, halo }
    this.pixels = []                        // NeoPixels 0 to 3: { mat, halo }
    this.pick = []                          // meshes a click can press a key through
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
    // the surface as drawn); each has a round pick target a little wider.
    KEYS_BY_NAME.forEach((name, n) => {
      const mesh = node(name)
      mesh.material = mesh.material.clone()
      mesh.material.flatShading = true
      const target = new THREE.Mesh(new THREE.CylinderGeometry(KEY_REACH, KEY_REACH, 3, 16), new THREE.MeshBasicMaterial({ visible: false }))
      target.position.copy(mesh.position)
      target.userData.key = n
      model.add(target)
      this.pick.push(target)
      this.keys[n] = { mesh, rest: mesh.position.y }
    })

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
    for (let n = 0; n < 4; n++) this.pixels[n] = this._light(node(`Neo_${n}`), 14)

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
  }

  // A light on the board: the part's own material, lit by emission, and a
  // glow over it (`glow` mm across) that shows at a distance.
  _light(mesh, glow) {
    const mat = mesh.material.clone()
    mat.toneMapped = false                  // a lit LED stays its own colour, not the film's
    mesh.material = mat
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: 0x000000, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }))
    halo.scale.setScalar(glow)
    halo.position.copy(centre(mesh)).add(new THREE.Vector3(0, 1.2, 0))
    halo.userData.realism = 'effects'       // drawn at the levels that have them (realism.js)
    mesh.parent.add(halo)
    return { mat, halo }
  }

  // Where the camera starts: in front, a little to the right and above, as
  // CodeSpace's showroom camera looks, near enough for the board (`size`
  // across) to fill the view and its screen to be read.
  home() {
    return {
      target: new THREE.Vector3(0, CODEX_HEIGHT, 0),
      from: new THREE.Vector3(0.3, 0.2, 1).normalize(),
      size: 0.14,
      minDistance: 0.05,
    }
  }

  // Key n's centre in the world.
  keyCentre(n) {
    return this.keys[n]?.mesh.getWorldPosition(new THREE.Vector3())
  }

  // The key a ray meets, or -1.
  keyAt(raycaster) {
    const hit = raycaster.intersectObjects(this.pick, false)[0]
    return hit ? hit.object.userData.key : -1
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
    // the backlight: off shows the panel itself
    this.screen.visible = s.brightness > 0
    this.screen.material.color.setScalar(Math.min(1, Math.max(0.05, s.brightness / 100)))
    s.leds?.forEach((on, n) => {
      const l = this.leds[n]
      if (!l) return
      l.mat.emissive.copy(on ? LED_RED : BLACK)
      l.halo.material.color.copy(on ? LED_RED : BLACK)
    })
    s.pixels?.forEach(([r, g, b], n) => {
      const p = this.pixels[n]
      if (!p) return
      // a dim pixel still reads as lit, as it does to the eye
      const lift = (v) => (v > 0 ? 0.25 + 0.75 * (v / 255) ** 0.5 : 0)
      p.mat.emissive.setRGB(lift(r), lift(g), lift(b))
      p.halo.material.color.setRGB(lift(r), lift(g), lift(b)).multiplyScalar(0.9)
    })
    s.buttons?.forEach((down, n) => {
      const k = this.keys[n]
      if (k) k.mesh.position.y = k.rest - (down ? KEY_TRAVEL : 0)
    })
  }
}

const BLACK = new THREE.Color(0, 0, 0)

// A mesh's centre, in its parent's frame.
function centre(mesh) {
  mesh.updateMatrix()
  mesh.geometry.computeBoundingBox()
  return mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrix)
}
