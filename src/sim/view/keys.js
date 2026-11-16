// A board's buttons as drawn: parts of its model that a click presses
// (view.js finds them with keyAt) and that go down while held. One mechanism
// for every board: CodeX's six keys and reset, CodeBot's BTN-0 and BTN-1,
// CodeAIR's BTN-0, BTN-1 and reset.
//
// Each button is given in its model's frame, whose +y is up from the board.
import * as THREE from 'three'
import { boxIn } from './led.js'

export class Keys {
  constructor() {
    this.keys = new Map()      // number -> { meshes, rest }
    this.pick = []             // the invisible targets a click finds
  }

  // Button `n` (the program's number for it, or a name such as 'reset'):
  // `meshes`, the parts that go down when it is pressed (siblings in one
  // model frame); `reach`, the radius a click finds it within; `travel`, how
  // far it goes down; both in that frame's units.
  add(n, meshes, { reach, travel }) {
    meshes = meshes.filter(Boolean)
    if (!meshes.length) return
    const frame = meshes[0].parent
    const box = new THREE.Box3()
    for (const m of meshes) box.union(boxIn(frame, m))
    const centre = box.getCenter(new THREE.Vector3())
    const height = box.max.y - box.min.y
    const target = new THREE.Mesh(
      new THREE.CylinderGeometry(reach, reach, Math.max(height, reach) * 1.5, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    target.position.copy(centre)
    target.userData.key = n
    frame.add(target)
    this.pick.push(target)
    this.keys.set(n, { meshes, rest: meshes.map((m) => m.position.y), travel, centre, frame })
  }

  // The button a ray meets, or -1.
  keyAt(raycaster) {
    const hit = raycaster.intersectObjects(this.pick, false)[0]
    return hit ? hit.object.userData.key : -1
  }

  // Button n's centre in the world.
  keyCentre(n) {
    const k = this.keys.get(n)
    return k && k.frame.localToWorld(k.centre.clone())
  }

  // Each button down while `down(n)` says it is held.
  show(down) {
    for (const [n, k] of this.keys) {
      const d = down(n) ? k.travel : 0
      k.meshes.forEach((m, i) => { m.position.y = k.rest[i] - d })
    }
  }
}
