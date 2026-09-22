import * as THREE from 'three'
import type ThreeGlobe from 'three-globe'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DEG2RAD, GLOBE_RADIUS } from './constants'
import { CITIES, ROUTE_ARCS } from './globeData'
import type { City } from './globeData'
import { geoToVector3 } from './globeMaterial'

export interface InteractionApp {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  globe: ThreeGlobe
  getGlobeMaterial: () => THREE.Material | null
}

export interface Interaction {
  update: (deltaSeconds: number) => void
  refresh: () => void
  setLayerEnabled: (layer: 'cities' | 'arcs', enabled: boolean) => void
  flyTo: (city: City) => void
}

const CITY_TOLERANCE_DEG = 3.2
const ARC_TOLERANCE_DEG = 2.4
const ARC_SAMPLES = 32
const CAMERA_REFERENCE_DISTANCE = GLOBE_RADIUS * 3.6
const FLIGHT_DURATION = 1.15
const CLICK_MAX_TRAVEL_PX = 5
const CLICK_MAX_DURATION_MS = 400

const cityDirections = new Map(CITIES.map((city) => [city, geoToVector3(city.lat, city.lng).normalize()]))

function slerpDirection(from: THREE.Vector3, to: THREE.Vector3, t: number): THREE.Vector3 {
  const omega = Math.acos(THREE.MathUtils.clamp(from.dot(to), -1, 1))
  if (omega < 1e-5) return from.clone()

  const sinOmega = Math.sin(omega)
  return from
    .clone()
    .multiplyScalar(Math.sin((1 - t) * omega) / sinOmega)
    .addScaledVector(to, Math.sin(t * omega) / sinOmega)
}

const arcPaths = ROUTE_ARCS.map((arc) => {
  const from = geoToVector3(arc.startLat, arc.startLng).normalize()
  const to = geoToVector3(arc.endLat, arc.endLng).normalize()

  const samples: THREE.Vector3[] = []
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    samples.push(slerpDirection(from, to, i / ARC_SAMPLES))
  }

  return { route: arc.route, samples }
})

function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}\u00b0${lat >= 0 ? 'N' : 'S'}`
}

function formatLongitude(lng: number): string {
  return `${Math.abs(lng).toFixed(2)}\u00b0${lng >= 0 ? 'E' : 'W'}`
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

type HoverInfo =
  | { kind: 'city'; city: City; lat: number; lng: number }
  | { kind: 'arc'; route: string; lat: number; lng: number }
  | { kind: 'surface'; lat: number; lng: number }

export function setupInteraction(app: InteractionApp, tooltipEl: HTMLElement): Interaction {
  const canvas = app.renderer.domElement

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const pointerClient = { x: 0, y: 0 }

  let globeMesh: THREE.Mesh | null = null
  let pointerDirty = false
  let pointerInside = false
  let elapsed = 0

  const enabled = { cities: true, arcs: true }

  const highlight = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.6, 48),
    new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  )
  highlight.name = 'city-highlight'
  highlight.renderOrder = 999
  highlight.visible = false
  app.globe.add(highlight)

  const outward = new THREE.Vector3(0, 0, 1)
  const localPoint = new THREE.Vector3()
  const direction = new THREE.Vector3()

  function scanGlobeMesh(): void {
    const material = app.getGlobeMaterial()
    if (!material) return

    app.globe.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.material === material) globeMesh = mesh
    })
  }

  function toleranceDegrees(base: number): number {
    const distance = app.camera.position.length()
    return THREE.MathUtils.clamp(base * (distance / CAMERA_REFERENCE_DISTANCE), 1.2, 9)
  }

  function nearestCity(dir: THREE.Vector3, toleranceDeg: number): City | null {
    const threshold = Math.cos(toleranceDeg * DEG2RAD)

    let best: City | null = null
    let bestDot = threshold

    for (const city of CITIES) {
      const dot = dir.dot(cityDirections.get(city)!)
      if (dot > bestDot) {
        bestDot = dot
        best = city
      }
    }

    return best
  }

  function nearestArc(dir: THREE.Vector3, toleranceDeg: number): string | null {
    const threshold = Math.cos(toleranceDeg * DEG2RAD)

    let best: string | null = null
    let bestDot = threshold

    for (const arc of arcPaths) {
      for (const sample of arc.samples) {
        const dot = dir.dot(sample)
        if (dot > bestDot) {
          bestDot = dot
          best = arc.route
        }
      }
    }

    return best
  }

  function directionToGeo(dir: THREE.Vector3): { lat: number; lng: number } {
    const normalized = dir.clone().normalize()
    const lat = 90 - Math.acos(THREE.MathUtils.clamp(normalized.y, -1, 1)) / DEG2RAD
    const lng = 90 - Math.atan2(normalized.z, normalized.x) / DEG2RAD

    return { lat, lng: ((lng + 540) % 360) - 180 }
  }

  function resolveHover(): HoverInfo | null {
    if (!globeMesh) scanGlobeMesh()
    if (!globeMesh) return null

    raycaster.setFromCamera(pointer, app.camera)

    const hits = raycaster.intersectObject(globeMesh, false)
    if (hits.length === 0) return null

    localPoint.copy(hits[0].point)
    app.globe.worldToLocal(localPoint)
    direction.copy(localPoint).normalize()

    const geo = directionToGeo(direction)

    if (enabled.cities) {
      const city = nearestCity(direction, toleranceDegrees(CITY_TOLERANCE_DEG))
      if (city) return { kind: 'city', city, ...geo }
    }

    if (enabled.arcs) {
      const route = nearestArc(direction, toleranceDegrees(ARC_TOLERANCE_DEG))
      if (route) return { kind: 'arc', route, ...geo }
    }

    return { kind: 'surface', ...geo }
  }

  function tooltipMarkup(info: HoverInfo): string {
    const coords = `${formatLatitude(info.lat)} &middot; ${formatLongitude(info.lng)}`

    if (info.kind === 'city') {
      const badge = info.city.hub ? '<em class="tooltip-badge">Hub</em>' : ''
      return `<div class="tooltip-title"><strong>${info.city.name}</strong>${badge}</div><span>${coords}</span>`
    }

    if (info.kind === 'arc') {
      const route = info.route.replace(' -> ', ' \u2192 ')
      return `<div class="tooltip-title"><strong>${route}</strong></div><span>Route &middot; ${coords}</span>`
    }

    return `<div class="tooltip-title"><strong>${coords}</strong></div><span>Open ocean</span>`
  }

  function positionTooltip(): void {
    const margin = 14
    const rect = tooltipEl.getBoundingClientRect()

    let left = pointerClient.x + margin
    let top = pointerClient.y + margin

    if (left + rect.width > window.innerWidth - 8) left = pointerClient.x - rect.width - margin
    if (top + rect.height > window.innerHeight - 8) top = pointerClient.y - rect.height - margin

    tooltipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  function applyHover(info: HoverInfo | null): void {
    if (!info) {
      tooltipEl.classList.add('hidden')
      highlight.visible = false
      canvas.style.cursor = ''
      return
    }

    tooltipEl.innerHTML = tooltipMarkup(info)
    tooltipEl.classList.remove('hidden')
    positionTooltip()

    if (info.kind === 'city') {
      const position = geoToVector3(info.city.lat, info.city.lng).multiplyScalar(GLOBE_RADIUS * 1.006)
      highlight.position.copy(position)
      highlight.quaternion.setFromUnitVectors(outward, position.clone().normalize())
      highlight.visible = true
      canvas.style.cursor = 'pointer'
    } else {
      highlight.visible = false
      canvas.style.cursor = ''
    }
  }

  let flight: {
    fromDirection: THREE.Vector3
    toDirection: THREE.Vector3
    fromRadius: number
    toRadius: number
    progress: number
    restoreAutoRotate: boolean
  } | null = null

  const globeQuaternion = new THREE.Quaternion()

  function flyTo(city: City): void {
    app.globe.updateWorldMatrix(true, false)
    app.globe.getWorldQuaternion(globeQuaternion)

    const toDirection = geoToVector3(city.lat, city.lng)
      .normalize()
      .applyQuaternion(globeQuaternion)

    flight = {
      fromDirection: app.camera.position.clone().normalize(),
      toDirection,
      fromRadius: app.camera.position.length(),
      toRadius: GLOBE_RADIUS * 2.1,
      progress: 0,
      restoreAutoRotate: app.controls.autoRotate,
    }

    app.controls.autoRotate = false
  }

  function updateFlight(deltaSeconds: number): void {
    if (!flight) return

    flight.progress = Math.min(1, flight.progress + deltaSeconds / FLIGHT_DURATION)
    const eased = easeInOutCubic(flight.progress)

    const directionNow = flight.fromDirection.clone().lerp(flight.toDirection, eased).normalize()
    const radiusNow = THREE.MathUtils.lerp(flight.fromRadius, flight.toRadius, eased)
    app.camera.position.copy(directionNow.multiplyScalar(radiusNow))

    if (flight.progress >= 1) {
      app.controls.autoRotate = flight.restoreAutoRotate
      flight = null
    }
  }

  function updatePointer(event: PointerEvent): void {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
    pointerClient.x = event.clientX
    pointerClient.y = event.clientY
    pointerDirty = true
  }

  let pointerDownAt = 0
  let pointerDownX = 0
  let pointerDownY = 0

  canvas.addEventListener('pointermove', (event) => {
    pointerInside = true
    updatePointer(event)
  })

  canvas.addEventListener('pointerleave', () => {
    pointerInside = false
    pointerDirty = true
  })

  canvas.addEventListener('pointerdown', (event) => {
    pointerDownAt = performance.now()
    pointerDownX = event.clientX
    pointerDownY = event.clientY
  })

  canvas.addEventListener('pointerup', (event) => {
    const travel = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY)
    const elapsedMs = performance.now() - pointerDownAt

    if (travel > CLICK_MAX_TRAVEL_PX || elapsedMs > CLICK_MAX_DURATION_MS) return

    updatePointer(event)
    const info = resolveHover()
    if (info?.kind === 'city') flyTo(info.city)
  })

  function update(deltaSeconds: number): void {
    elapsed += deltaSeconds

    if (flight) {
      updateFlight(deltaSeconds)
    }

    if (pointerDirty) {
      pointerDirty = false
      applyHover(pointerInside ? resolveHover() : null)
    }

    if (highlight.visible) {
      const pulse = 1 + Math.sin(elapsed * 4.2) * 0.07
      highlight.scale.setScalar(pulse)
    }
  }

  return {
    update,
    refresh: scanGlobeMesh,
    setLayerEnabled: (layer, isEnabled) => {
      enabled[layer] = isEnabled
      if (pointerInside) pointerDirty = true
    },
    flyTo,
  }
}
