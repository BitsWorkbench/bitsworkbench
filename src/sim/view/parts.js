/**
 * The named parts of a board's model, for a click on the simulated board:
 * which part it landed on, by the name the CAD gives it (the model's
 * `.parts.json`, written by sim/tools/build-models.mjs). A mission pack's
 * `pick` check asks for a part by that name (docs/mission-packs.md).
 *
 * The built model joins most parts into one mesh, so a part is found by
 * where the click lands: the smallest part's box around that point.
 */
import * as THREE from 'three'

export class Parts {
  /** `model`: the model as loaded (its scene); `boxes`: [{ name, min, max }] in its coordinates. */
  constructor(model, boxes) {
    this.model = model
    this.boxes = boxes.map((b) => ({ name: b.name, box: new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)) }))
    const all = new THREE.Box3()
    this.boxes.forEach((b) => all.union(b.box))
    // A point on a part's surface may sit a hair outside its box.
    this.slack = all.isEmpty() ? 0 : all.getSize(new THREE.Vector3()).length() * 0.002
  }

  /**
   * The part a ray meets first, or null. The first hit inside a part counts:
   * a key's invisible press target (keys.js) stands a little proud of the
   * board, outside every part.
   */
  at(raycaster) {
    for (const hit of raycaster.intersectObject(this.model, true)) {
      const name = this.around(this.model.worldToLocal(hit.point.clone()))
      if (name) return name
    }
    return null
  }

  /** The smallest part whose box holds a point in the model's coordinates, or null. */
  around(point) {
    let best = null
    let bestVolume = Infinity
    for (const { name, box } of this.boxes) {
      if (!box.clone().expandByScalar(this.slack).containsPoint(point)) continue
      const s = box.getSize(new THREE.Vector3())
      const volume = (s.x + this.slack) * (s.y + this.slack) * (s.z + this.slack)
      if (volume < bestVolume) {
        best = name
        bestVolume = volume
      }
    }
    return best
  }
}

/** A model's parts file, or [] when there is none (a click then names no part). */
export async function loadParts(url) {
  try {
    const res = await fetch(url)
    return res.ok ? await res.json() : []
  } catch {
    return []
  }
}
