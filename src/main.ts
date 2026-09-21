import './style.css'
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

const GLOBE_RADIUS = 100
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2)

const host = document.querySelector<HTMLDivElement>('#app')!
const loading = document.querySelector<HTMLDivElement>('#loading')

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(MAX_PIXEL_RATIO)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.25
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04060c)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 6000)
camera.position.set(0, GLOBE_RADIUS * 0.7, GLOBE_RADIUS * 3.6)
camera.lookAt(0, 0, 0)

const globe = new ThreeGlobe({ waitForGlobeReady: true, animateIn: true })
  .globeImageUrl('/img/earth-blue-marble.jpg')
  .bumpImageUrl('/img/earth-topology.png')
  .showAtmosphere(true)
  .atmosphereColor('#8ecbff')
  .atmosphereAltitude(0.16)

globe.rotation.z = THREE.MathUtils.degToRad(-23.4)
scene.add(globe)

globe.onGlobeReady(() => loading?.classList.add('hidden'))

scene.add(new THREE.AmbientLight(0xffffff, 2.9))

const keyLight = new THREE.DirectionalLight(0xffffff, 2.3)
keyLight.position.set(2.5, 1.5, 3.5).normalize()
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x9fc4ff, 1.1)
fillLight.position.set(-2.5, -1, -3.5).normalize()
scene.add(fillLight)

function createStarfield(count: number, innerRadius: number, outerRadius: number): THREE.Points {
  const positions = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const radius = innerRadius + Math.random() * (outerRadius - innerRadius)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = radius * Math.cos(phi)
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  })

  return new THREE.Points(geometry, material)
}

scene.add(createStarfield(6000, 1200, 2800))

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.rotateSpeed = 0.55
controls.zoomSpeed = 0.8
controls.enablePan = false
controls.minDistance = GLOBE_RADIUS * 1.25
controls.maxDistance = GLOBE_RADIUS * 9
controls.autoRotate = true
controls.autoRotateSpeed = 0.45
controls.target.set(0, 0, 0)

const composer = new EffectComposer(renderer)
composer.setPixelRatio(MAX_PIXEL_RATIO)
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,
  0.35,
  0.68,
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

function toggleGraticules(): void {
  globe.showGraticules(!globe.showGraticules())
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'g' || event.key === 'G') toggleGraticules()
})

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

renderer.setAnimationLoop(() => {
  controls.update()
  composer.render()
})

if (import.meta.env.DEV) {
  Object.assign(window, { __globe: { THREE, scene, camera, controls, globe, composer, renderer, bloom } })
}
