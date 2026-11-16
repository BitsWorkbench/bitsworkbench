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
const BLACK = new THREE.Color(0, 0, 0)
const GLOW = 0.85                // the glow's strength at its middle, lit full

// A light's look: `mat` its body's material (a lens, or the part's own),
// `halo` its glow; `rest` the body's colour unlit.
export class Light {
  constructor(mat, halo, rest = mat.color.clone()) {
    this.mat = mat
    this.halo = halo
    this.rest = rest.clone()
    this.restOpacity = mat.opacity
    this.color = new THREE.Color(1, 1, 1)
    this.level = 0
    this.show(this.color, 0)
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
    this.mat.emissive.copy(this.color).multiplyScalar(k)
    this.mat.color.copy(lit ? BLACK : this.rest)
    this.mat.opacity = lit ? 1 : this.restOpacity
    this.mat.toneMapped = !lit
    this.halo.material.color.copy(this.color)
    this.halo.material.opacity = GLOW * k
    this.halo.visible = lit
  }
}

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
  // facing: 1 for an LED on a board's top, -1 for one on its underside.
  constructor(parent, position, size, color, glow, facing = 1) {
    const mat = new THREE.MeshStandardMaterial({
      color: LENS, transparent: true, opacity: 0.8, roughness: 0.35, metalness: 0,
      emissive: 0x000000,
    })
    const halo = glowSprite(glow)
    super(mat, halo, LENS)
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
