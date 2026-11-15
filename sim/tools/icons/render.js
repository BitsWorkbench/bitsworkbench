// Draws one device, as the simulator draws it, on a transparent canvas, for
// sim/tools/render-icons.mjs to save as the device's icon. CodeBot and CodeAIR
// are the simulator's own figures; CodeX is its model (sim/assets/CodeX.glb).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CodeBotFigure } from '../../../src/sim/view/codebot-figure.js'
import { CodeAIRFigure } from '../../../src/sim/view/codeair-figure.js'

const SIZE = 512
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(SIZE, SIZE)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

// Each device: how to get it, and the direction the camera looks from
// (a unit-ish vector from the device's centre).
const DEVICES = {
  async codebot() {
    const fig = new CodeBotFigure()
    await fig.load(loader, '/sim-assets/')
    return { object: fig.root, from: [1.0, 0.85, 0.75] } // front-left, from above
  },
  async codeair() {
    const fig = new CodeAIRFigure()
    await fig.load(loader, '/sim-assets/')
    return { object: fig.root, from: [0.9, 1.1, 0.8] }
  },
  async codex() {
    const gltf = await loader.loadAsync('/sim/assets/CodeX.glb')
    const model = gltf.scene
    // At icon size the near-black board, screen and buttons run together, so
    // the icon shows the CodeX switched on: its screen lit, its buttons light
    // grey, and a room for its metal parts to reflect (they are black with
    // nothing to reflect).
    // The keys' normals face the wrong way, so they shade flat (normals from
    // the surface as drawn) to show light.
    model.traverse((o) => {
      if (o.isMesh && /^BTN_[UDLRAB]$/.test(o.name)) {
        o.material = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, flatShading: true })
      }
    })
    // The lit display, just over the screen's glass (LCD_Shield): its centre,
    // in the model's millimetres.
    const glass = new THREE.Box3().setFromObject(model.getObjectByName('LCD_Shield'))
    const centre = glass.getCenter(new THREE.Vector3())
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), litScreen())
    screen.rotation.x = -Math.PI / 2
    screen.position.set(centre.x, glass.max.y + 0.05, centre.z)
    model.add(screen)
    // The model lies face up: look down on its screen, D-pad and A and B.
    // room: how strongly the room reflects (1 turns the board lime).
    return { object: model, from: [0, 1, 0.12], room: 0.35 }
  },
}

// The display lit, as the CodeX looks with a program showing colour on it.
function litScreen() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 128, 128)
  grad.addColorStop(0, '#5fd3ff')
  grad.addColorStop(1, '#4eb748')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshBasicMaterial({ map })
}

window.renderIcon = async (kind, from) => {
  const { object, from: look, room } = await DEVICES[kind]()
  // No floor here, so no floor shadows.
  object.traverse((o) => {
    if (o.userData?.realism === 'shadows') o.visible = false
  })
  const scene = new THREE.Scene()
  if (room) {
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = room
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5b4b, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(2, 5, 3)
  scene.add(sun)
  scene.add(object)
  object.updateMatrixWorld(true)

  // Frame the device: centre it, and stand back far enough for its bounding sphere.
  const box = new THREE.Box3().setFromObject(object)
  const centre = box.getCenter(new THREE.Vector3())
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 100)
  const dir = new THREE.Vector3(...(from || look)).normalize()
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(15))
  camera.position.copy(centre).addScaledVector(dir, distance)
  camera.lookAt(centre)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
window.iconsReady = true
