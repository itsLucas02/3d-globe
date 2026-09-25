import './style.css'
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { CITIES, HUBS, ROUTE_ARCS, SILOS } from './globeData'
import { createDayNightMaterial, geoToVector3, subsolarPoint } from './globeMaterial'
import { GLOBE_RADIUS } from './constants'
import { createLabelLayer } from './labels'
import { setupInteraction } from './interaction'
import { createControlPanel } from './panel'
import type { LayerId } from './panel'
import { createMissileSystem } from './missiles'
import { createSiloLayer } from './silos'
import { createExplosionSystem } from './explosions'

let sunTimeScale = 240

const lowPower =
  window.matchMedia('(pointer: coarse)').matches ||
  Math.min(window.innerWidth, window.innerHeight) < 640

const PROFILE = {
  maxPixelRatio: Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2),
  bloom: !lowPower,
  stars: lowPower ? 2500 : 6000,
  pointResolution: lowPower ? 8 : 12,
  arcCurveResolution: lowPower ? 36 : 72,
  arcCircularResolution: lowPower ? 5 : 8,
  ringResolution: lowPower ? 32 : 64,
}

const MAX_PIXEL_RATIO = PROFILE.maxPixelRatio

const host = document.querySelector<HTMLDivElement>('#app')!
const labelsHost = document.querySelector<HTMLDivElement>('#labels')!
const panelHost = document.querySelector<HTMLDivElement>('#panel-root')!
const tooltipEl = document.querySelector<HTMLDivElement>('#tooltip')!
const loading = document.querySelector<HTMLDivElement>('#loading')
const clockEl = document.querySelector<HTMLSpanElement>('#clock')

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

const globe = new ThreeGlobe({ waitForGlobeReady: false, animateIn: true })
  .showAtmosphere(true)
  .atmosphereColor('#8ecbff')
  .atmosphereAltitude(0.16)
  .pointsData(CITIES)
  .pointLat('lat')
  .pointLng('lng')
  .pointColor((city: object) => ((city as { hub?: boolean }).hub ? '#d6f2ff' : '#7fe3ff'))
  .pointAltitude((city: object) => ((city as { hub?: boolean }).hub ? 0.025 : 0.012))
  .pointRadius((city: object) => ((city as { hub?: boolean }).hub ? 0.3 : 0.2))
  .pointResolution(PROFILE.pointResolution)
  .pointsMerge(true)
  .arcsData(ROUTE_ARCS)
  .arcColor(() => ['#22d3ee', '#818cf8'])
  .arcAltitudeAutoScale(0.42)
  .arcStroke(0.65)
  .arcCurveResolution(PROFILE.arcCurveResolution)
  .arcCircularResolution(PROFILE.arcCircularResolution)
  .arcDashLength(0.4)
  .arcDashGap(0.6)
  .arcDashAnimateTime(3200)
  .ringsData(HUBS)
  .ringLat('lat')
  .ringLng('lng')
  .ringColor(() => (t: number) => `rgba(127,227,255,${(1 - t) * 0.85})`)
  .ringMaxRadius(4)
  .ringPropagationSpeed(3)
  .ringRepeatPeriod(1000)
  .ringResolution(PROFILE.ringResolution)

// The globe's own transform is driven by three-globe's animateIn tween, so tilt a
// wrapper instead of the globe itself.
const globeRoot = new THREE.Group()
globeRoot.rotation.z = THREE.MathUtils.degToRad(-23.4)
globeRoot.add(globe)
scene.add(globeRoot)

let globeMaterial: THREE.ShaderMaterial | null = null
let simulatedTime = Date.now()

const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
const textureLoader = new THREE.TextureLoader()
const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`

const explosions = createExplosionSystem({
  globe,
  quality: lowPower ? 'low' : 'high',
})

const missiles = createMissileSystem({
  scene,
  globe,
  assetUrl,
  autoLaunch: true,
  autoLaunchInterval: 9,
  onImpact: (position, _normal, scale) => explosions.spawn(position, { scale }),
})

const silos = createSiloLayer({ globe, silos: SILOS })

Promise.all([
  textureLoader.loadAsync(assetUrl('img/earth-blue-marble.webp')),
  textureLoader.loadAsync(assetUrl('img/earth-night.webp')),
])
  .then(([dayTexture, nightTexture]) => {
    dayTexture.anisotropy = maxAnisotropy
    nightTexture.anisotropy = maxAnisotropy

    globeMaterial = createDayNightMaterial(dayTexture, nightTexture)
    globe.globeMaterial(globeMaterial)
    loading?.classList.add('hidden')
  })
  .catch((error: unknown) => {
    console.error('Failed to load globe textures', error)
    loading?.classList.add('hidden')
  })

const ambientLight = new THREE.AmbientLight(0xffffff, 1.6)
scene.add(ambientLight)

const keyLight = new THREE.DirectionalLight(0xffffff, 2.3)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x9fc4ff, 1.1)
scene.add(fillLight)

const sunDirection = new THREE.Vector3(1, 0, 0)
const globeQuaternion = new THREE.Quaternion()

function updateSun(deltaSeconds: number): void {
  simulatedTime += deltaSeconds * 1000 * sunTimeScale
  const date = new Date(simulatedTime)
  const { lat, lng } = subsolarPoint(date)

  globe.updateWorldMatrix(true, false)
  globe.getWorldQuaternion(globeQuaternion)
  sunDirection.copy(geoToVector3(lat, lng)).applyQuaternion(globeQuaternion).normalize()

  const uniforms = globeMaterial?.uniforms
  if (uniforms) (uniforms.sunDirection.value as THREE.Vector3).copy(sunDirection)

  keyLight.position.copy(sunDirection).multiplyScalar(GLOBE_RADIUS * 6)
  fillLight.position.copy(sunDirection).multiplyScalar(-GLOBE_RADIUS * 6)

  if (clockEl) {
    const hh = String(date.getUTCHours()).padStart(2, '0')
    const mm = String(date.getUTCMinutes()).padStart(2, '0')
    clockEl.textContent = `${hh}:${mm} UTC`
  }
}

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

scene.add(createStarfield(PROFILE.stars, 1200, 2800))

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
  0.55,
  0.4,
  0.82,
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

bloom.enabled = PROFILE.bloom

const labels = createLabelLayer(labelsHost, scene, camera, globe, CITIES)

const interaction = setupInteraction(
  { scene, camera, renderer, controls, globe, getGlobeMaterial: () => globeMaterial },
  tooltipEl,
)

function setLayerVisible(layer: LayerId, visible: boolean): void {
  switch (layer) {
    case 'routes':
      globe.arcsData(visible ? ROUTE_ARCS : [])
      interaction.setLayerEnabled('arcs', visible)
      break
    case 'cities':
      globe.pointsData(visible ? CITIES : [])
      interaction.setLayerEnabled('cities', visible)
      break
    case 'rings':
      globe.ringsData(visible ? HUBS : [])
      break
    case 'missiles':
      missiles.setVisible(visible)
      explosions.setVisible(visible)
      break
    case 'silos':
      silos.setVisible(visible)
      break
    case 'graticules':
      globe.showGraticules(visible)
      break
    case 'labels':
      labels.setVisible(visible)
      break
  }
}

const panel = createControlPanel(
  panelHost,
  {
    setLayer: setLayerVisible,
    setAutoRotate: (enabled) => {
      controls.autoRotate = enabled
    },
    setSunSpeed: (scale) => {
      sunTimeScale = scale
    },
    launch: (strike) => missiles.launch(strike),
  },
  {
    sunSpeed: sunTimeScale,
    autoRotate: controls.autoRotate,
    origins: SILOS,
    targets: CITIES,
    layers: {
      routes: true,
      cities: true,
      rings: true,
      missiles: true,
      silos: true,
      graticules: Boolean(globe.showGraticules()),
      labels: true,
    },
  },
)

window.addEventListener('keydown', (event) => {
  if (event.key === 'g' || event.key === 'G') {
    const next = !globe.showGraticules()
    setLayerVisible('graticules', next)
    panel.setLayerChecked('graticules', next)
  }

  if (event.key === 'h' || event.key === 'H') panel.toggle()
})

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  labels.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

let lastFrameTime = performance.now()

renderer.setAnimationLoop((time: number) => {
  const delta = Math.min((time - lastFrameTime) / 1000, 0.1)
  lastFrameTime = time
  updateSun(delta)
  interaction.update(delta)
  missiles.update(delta)
  explosions.update(delta)
  silos.update(delta)
  controls.update()
  composer.render()
  labels.render()
})

const debugEnabled =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')

if (debugEnabled) {
  Object.assign(window, {
    __globe: {
      scene,
      camera,
      controls,
      globe,
      composer,
      renderer,
      bloom,
      labels,
      interaction,
      panel,
      missiles,
      explosions,
      silos,
      getGlobeMaterial: () => globeMaterial,
    },
  })
}
