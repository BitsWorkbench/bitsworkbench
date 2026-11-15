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
