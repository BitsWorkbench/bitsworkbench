// LEDs as drawn on a board: a small clear package that shows its pale lens
// when unlit (never a black box) and its own colour when lit, with a soft
// glow over it that reads at a distance. Unlit, the look follows CodeSpace's
// simulator: the lens 0.956, 0.921, 0.721 at 80% opacity.
//
// Lit, every LED and NeoPixel on every board has one look (`Light`), made
// to keep the colour the program asked for, at full brightness too:
//   - the colour is the program's red, green and blue as a screen shows
//     them (sRGB), scaled together so the brightest is full: brightness
//     changes how bright, never which colour (lifting each channel on its
//     own turns orange, 255 165 0, toward yellow);
//   - the body is its light alone and solid: no pale package under it to
//     wash the colour toward white, never driven past full (a channel past
//     full clips, and orange clips to yellow), and not tone mapped (the
//     film curve pulls bright colours toward white);
//   - the glow is a tint of the same colour laid over what is around it,
//     not light added to it: added light over a lit body or a pale surface
//     runs to white, and over a green board turns red toward yellow.
// CodeSpace's simulator does the same in Babylon: its emissive colour is
// the program's colour as is, with a glow layer of that colour around it.
import * as THREE from 'three'

const LENS = new THREE.Color(0.956, 0.921, 0.721)
const GLOW = 0.85                // the glow's strength at its middle, lit full

// How a lit light looks, for each board: the numbers the LED tuner
// (led-tuner.js, ?tune=leds) sets live, and shows to copy back here.
//   colour    how much of the light's colour its body has as a painted
//             surface (lit by the room), 0 none: a light is its own light
//   emissive  how bright its body glows, 1 its colour at full; past 1 it
//             goes toward white, keeping its hue (hot, below), a hot centre
//   opacity   the lit body's opacity, under 1 the board shows through
//   glow      the glow's strength, 1 as drawn before
//   size      the glow's size, 1 as drawn before
//   add       the glow added as light (true), or laid over as a tint
//   toneMap   the lit body through the room's tone curve (false: its colour
//             as the program set it)
export const LOOK_DEFAULTS = Object.freeze({
  codebot: Object.freeze({ colour: 0, emissive: 1.4, opacity: 0.7, glow: 1.6, size: 1.6, add: false, toneMap: false }),
  codex: Object.freeze({ colour: 0, emissive: 1.4, opacity: 0.7, glow: 1.6, size: 1.6, add: false, toneMap: false }),
  codeair: Object.freeze({ colour: 0, emissive: 1.4, opacity: 0.7, glow: 1.6, size: 1.6, add: false, toneMap: false }),
})
// The looks in use, by board: the defaults, changed only by the tuner.
export const LOOKS = Object.fromEntries(Object.entries(LOOK_DEFAULTS).map(([k, v]) => [k, { ...v }]))

// A light's look: `mat` its body's material (a lens, or the part's own),
// `halo` its glow; `rest` the body's colour unlit; `glow` the glow's
// strength, 1 the most. A lens whose material is invisible unlit (a
// NeoPixel's, over the part's own cup) shows only when lit. `look`: its
// board's entry in LOOKS (a figure sets it).
export class Light {
  constructor(mat, halo, rest = mat.color.clone(), glow = 1) {
    this.mat = mat
    this.halo = halo
    this.rest = rest.clone()
    this.restOpacity = mat.opacity
    this.restVisible = mat.visible
    this.restTransparent = mat.transparent
    this.glow = glow
    this.haloSize = halo.scale.x
    this.look = LOOKS.codebot
    this.color = new THREE.Color(1, 1, 1)
    this.level = 0
    this.show(this.color, 0)
  }

  /** Draw again as it is: after its look changed (the tuner). */
  refresh() {
    this.show(this.color, this.level)
  }

  // An RGB pixel: each 0 to 255, as a program sets it.
  rgb(r, g, b) {
    const top = Math.max(r, g, b)
    if (top > 0) this.color.setRGB(r / top, g / top, b / top, THREE.SRGBColorSpace)
    this.show(this.color, top / 255)
  }

  // `color` at `level`, 0 (off) to 1 (full): a dim LED still reads as lit,
  // as it does to the eye.
  show(color, level) {
    if (color !== this.color) this.color.copy(color)
    this.level = level
    const k = level > 0 ? 0.35 + 0.65 * Math.sqrt(Math.min(1, level)) : 0
    const lit = k > 0
    const look = this.look
    const m = this.mat
    hot(m.emissive.copy(this.color), k * look.emissive)
    if (lit) m.color.copy(this.color).multiplyScalar(look.colour * k)
    else m.color.copy(this.rest)
    m.opacity = lit ? look.opacity : this.restOpacity
    const clear = lit ? look.opacity < 1 : this.restTransparent
    const toneMapped = lit ? look.toneMap : true
    // a change of these recompiles the material's shader: only when they change
    if (m.transparent !== clear || m.toneMapped !== toneMapped) {
      m.transparent = clear
      m.toneMapped = toneMapped
      m.needsUpdate = true
    }
    m.visible = lit || this.restVisible
    const h = this.halo.material
    h.color.copy(this.color)
    h.opacity = Math.min(1, GLOW * this.glow * look.glow * k)
    const blending = look.add ? THREE.AdditiveBlending : THREE.NormalBlending
    if (h.blending !== blending) { h.blending = blending; h.needsUpdate = true }
    this.halo.scale.setScalar(this.haloSize * look.size)
    this.halo.visible = lit
  }
}

// A board's lights take its look (LOOKS), drawn at once in it.
export function wear(lights, board) {
  for (const l of lights) {
    l.look = LOOKS[board]
    l.refresh()
  }
}

// `c` (its brightest channel full) at `k` times its brightness, in place.
// Up to 1, simply brighter. Past 1 a screen has no more to give, and each
// channel clipping on its own changes the colour (orange to yellow); so the
// colour stays full and the rest goes toward white, half of what is past 1:
// a hotter light of the same hue, as a bright LED looks to a camera. The mix
// is made as the screen shows it (sRGB): mixed in linear light, orange slides
// toward red.
export function hot(c, k) {
  if (k <= 1) return c.multiplyScalar(k)
  const w = Math.min(1, (k - 1) / 2)
  return c.convertLinearToSRGB().lerp(WHITE, w).convertSRGBToLinear()
}
const WHITE = new THREE.Color(1, 1, 1)

// A glow `size` across (in its parent's units): a soft disc of a light's
// colour, laid over the scene.
export function glowSprite(size) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), transparent: true, depthWrite: false, toneMapped: false,
  }))
  halo.scale.setScalar(size)
  halo.userData.realism = 'effects'   // drawn at the levels that have them (realism.js)
  return halo
}

export class Led extends Light {
  // size [x, y, z] in the parent's units; glow: the halo's width there;
  // facing: 1 for an LED on a board's top, -1 for one on its underside;
  // strength: the glow's, 1 the most; clear: a lens that shows only lit,
  // the part's own look showing through unlit.
  constructor(parent, position, size, color, glow, facing = 1, { strength = 1, clear = false } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: LENS, transparent: true, opacity: 0.8, roughness: 0.35, metalness: 0,
      emissive: 0x000000, visible: !clear,
    })
    const halo = glowSprite(glow)
    super(mat, halo, LENS, strength)
    this.color.set(color)
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat)
    this.mesh.position.copy(position)
    parent.add(this.mesh)
    halo.position.copy(position)
    halo.position.y += facing * size[1]
    parent.add(halo)
  }

  // level 0 (off) to 1 (full), in the LED's own colour
  set(level) {
    this.show(this.color, level)
  }
}

// An object's box, in `frame`'s coordinates (the frame an ancestor of it).
export function boxIn(frame, object) {
  frame.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert()
  const box = new THREE.Box3()
  object.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.computeBoundingBox()
    box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)))
  })
  return box
}

// How far an object is turned about the vertical in `frame` (an ancestor of
// it), from its own geometry: the turn of the smallest rectangle around its
// footprint, in radians, between -pi/4 and pi/4 (a part's footprint repeats
// every quarter turn). A part placed at an angle on a board, such as a
// NeoPixel on a drone's arm, gets its lens at that angle.
export function yawIn(frame, object) {
  frame.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert()
  const pts = []
  const v = new THREE.Vector3()
  object.traverse((o) => {
    if (!o.isMesh) return
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      pts.push([v.x, v.z])
    }
  })
  // the footprint's convex hull (monotone chain); the smallest rectangle
  // around it has a side along one of its edges
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list) => {
    const h = []
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    return h.slice(0, -1)
  }
  const hull = [...half(pts), ...half([...pts].reverse())]
  let best = { area: Infinity, angle: 0 }
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const c = Math.cos(angle), s = Math.sin(angle)
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity
    for (const [x, z] of hull) {
      const u = c * x + s * z, w = -s * x + c * z
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w)
    }
    const area = (u1 - u0) * (w1 - w0)
    if (area < best.area - 1e-12) best = { area, angle }
  })
  // an edge along (cos a, sin a) in (x, z) is three's x axis turned by -a
  const q = Math.PI / 2
  let yaw = -best.angle
  yaw -= Math.round(yaw / q) * q
  return yaw
}

// A NeoPixel's lens, from its part's geometry in `frame` (an ancestor of
// it): a NeoPixel is a white body with a square cup in its top face, where
// the LED and its clear lens sit. Returns the cup's middle at the top face
// (`centre`), its side there (`side`), its depth (`depth`), the part's turn
// (`yaw`, as yawIn) and its outside (`body`, the side of its footprint), all
// in the frame's units. facing: 1 for a part on a board's top, -1 for one
// on its underside (its cup opens downward).
//
// The cup's rim is the top face's inner edge: of the top face's corners, the
// nearest the middle (measured square-wise, along the part's sides) are on
// it. Its floor is the level, below the top, of the corners inside the rim.
export function lensIn(frame, part, facing = 1) {
  const yaw = yawIn(frame, part)
  frame.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert()
  const pts = []
  part.traverse((o) => {
    if (!o.isMesh) return
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m))
  })
  // along the part's sides: u, w (three turns +x by yaw toward -z)
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const uw = (p) => [c * p.x - s * p.z, s * p.x + c * p.z]
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of pts) {
    const [u, w] = uw(p)
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w)
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
  }
  const um = (u0 + u1) / 2, wm = (w0 + w1) / 2
  const top = facing > 0 ? y1 : y0
  const eps = (y1 - y0) * 0.01
  const out = (p) => { const [u, w] = uw(p); return Math.max(Math.abs(u - um), Math.abs(w - wm)) }
  let half = Infinity
  for (const p of pts) if (Math.abs(p.y - top) < eps) half = Math.min(half, out(p))
  let depth = 0
  for (const p of pts) {
    if (Math.abs(p.y - top) < eps || out(p) >= half * 0.98) continue
    const d = Math.abs(top - p.y)
    if (depth === 0 || d < depth) depth = d
  }
  // the middle back in the frame: (u, w) turned back by yaw
  const centre = new THREE.Vector3(c * um + s * wm, top, -s * um + c * wm)
  return { centre, side: 2 * half, depth, yaw, body: Math.min(u1 - u0, w1 - w0) }
}

// A NeoPixel lit over its cup: a clear solid that fills the cup to just over
// its rim, so the white body shows round it, lit in the program's colour,
// and a faint glow over it, a little over twice the part's width: light
// from the lens, not a cloud over the board. Unlit, the part's own cup
// shows. frame: the part's ancestor that the lens joins.
export function neoPixel(frame, part, facing = 1) {
  const lens = lensIn(frame, part, facing)
  const side = lens.side * 0.98                 // inside the rim
  const over = lens.depth * 0.08                // standing just over the top face
  const h = lens.depth + over
  const at = lens.centre.clone()
  at.y += facing * (over - h / 2)
  const led = new Led(frame, at, [side, h, side], 0xffffff, lens.body * 2.5, facing, { strength: 0.6, clear: true })
  led.mesh.rotation.y = lens.yaw
  led.halo.position.y = lens.centre.y + facing * over * 2
  led.lens = lens
  led.part = part
  led.facing = facing
  return led
}

// Metal that shines: the figure's materials mirror the studio light `env`
// (view.js), so a silver connector or shield reads as silver, not black, in
// any room. Reflection only: the studio's diffuse light is left out, so the
// painted parts keep the colours the room's own lights give them.
export function reflect(object, env) {
  if (!env) return
  object.traverse((o) => {
    if (!o.isMesh) return
    for (const m of [o.material].flat()) {
      // metal: a palette's parts (metalness by part, in its texture) or a
      // plain material that is mostly metal; never a printed one, such as a
      // board's artwork, whatever finish its model gives it
      const metal = m.metalnessMap || (!m.map && m.metalness >= 0.5)
      if (!m.isMeshStandardMaterial || !metal) continue
      m.envMap = env
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>',
          THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''))
      }
      m.customProgramCacheKey = () => 'reflect-only'
    }
  })
}

let halo = null
export function haloTexture() {
  if (halo) return halo
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  // full over the light, falling off softly: a tint that reads as its glow
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  halo = new THREE.CanvasTexture(c)
  return halo
}
