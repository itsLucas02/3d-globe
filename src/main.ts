import './style.css'
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const GLOBE_RADIUS = 100

const host = document.querySelector<HTMLDivElement>('#app')!
const loading = document.querySelector<HTMLDivElement>('#loading')

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05070d)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 6000)
camera.position.set(0, GLOBE_RADIUS * 0.7, GLOBE_RADIUS * 3.6)
camera.lookAt(0, 0, 0)

const globe = new ThreeGlobe({ waitForGlobeReady: true, animateIn: true })
  .globeImageUrl('/img/earth-blue-marble.jpg')
  .bumpImageUrl('/img/earth-topology.png')
  .showAtmosphere(true)
  .atmosphereColor('#6fb7ff')
  .atmosphereAltitude(0.18)

globe.rotation.z = THREE.MathUtils.degToRad(-23.4)
scene.add(globe)

globe.onGlobeReady(() => loading?.classList.add('hidden'))

scene.add(new THREE.AmbientLight(0xffffff, 3.1))

const sun = new THREE.DirectionalLight(0xffffff, 2.1)
sun.position.set(2.5, 1.5, 3.5).normalize()
scene.add(sun)

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
    size: 1.7,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
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

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
