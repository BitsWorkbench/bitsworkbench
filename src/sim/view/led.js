// LEDs as drawn on a board: a small clear package that shows its pale lens
// when unlit (never a black box) and its own colour when lit, with a soft
// glow over it that reads at a distance. The look follows CodeSpace's
// simulator: the lens 0.956, 0.921, 0.721 at 80% opacity, lit by emission.
import * as THREE from 'three'

const LENS = new THREE.Color(0.956, 0.921, 0.721)
const BLACK = new THREE.Color(0, 0, 0)

export class Led {
  // size [x, y, z] in the parent's units; glow: the halo's width there;
  // facing: 1 for an LED on a board's top, -1 for one on its underside.
  constructor(parent, position, size, color, glow, facing = 1) {
    this.color = new THREE.Color(color)
    this.mat = new THREE.MeshStandardMaterial({
      color: LENS, transparent: true, opacity: 0.8, roughness: 0.35, metalness: 0,
      emissive: 0x000000,
    })
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), this.mat)
    this.mesh.position.copy(position)
    parent.add(this.mesh)
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: 0x000000, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }))
    this.halo.scale.setScalar(glow)
    this.halo.position.copy(position)
    this.halo.position.y += facing * size[1]
    this.halo.userData.realism = 'effects'   // drawn at the levels that have them (realism.js)
    parent.add(this.halo)
  }

  // An RGB pixel: each 0 to 255, its colour lifted the way set() lifts a level.
  rgb(r, g, b) {
    const top = Math.max(r, g, b)
    if (top > 0) this.color.setRGB(r / top, g / top, b / top)
    this.set(top / 255)
  }

  // level 0 (off) to 1 (full): a dim LED still reads as lit, as to the eye
  set(level) {
    const k = level > 0 ? 0.35 + 0.65 * Math.sqrt(Math.min(1, level)) : 0
    this.mat.emissive.copy(this.color).multiplyScalar(k * 1.6)
    // lit, the lens is its light alone (the pale lens under it would wash a
    // red out to pink), its own colour, not the film's
    this.mat.color.copy(k > 0 ? BLACK : LENS)
    this.mat.toneMapped = !(k > 0)
    this.halo.material.color.copy(this.color).multiplyScalar(k)
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
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  halo = new THREE.CanvasTexture(c)
  return halo
}
