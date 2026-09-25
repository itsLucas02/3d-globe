import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { geoToVector3 } from './globeMaterial'
import { GLOBE_RADIUS } from './constants'
import { CITIES, HUBS } from './globeData'

const UP = new THREE.Vector3(0, 1, 0)
const TRAIL_POINTS = 96

export interface MissileLaunch {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
  /** Seconds from lift-off to impact. */
  duration?: number
  /** Model length in world units (the mesh is authored 1 unit long). */
  scale?: number
}

export interface MissileSystemOptions {
  scene: THREE.Scene
  /** The globe object; positions are placed through its world transform. */
  globe: THREE.Object3D
  /** BASE_URL-aware asset resolver (see main.ts). */
  assetUrl: (path: string) => string
  modelPath?: string
  /** Apogee as a fraction of the globe radius. */
  apogee?: number
  duration?: number
  scale?: number
  /** Periodically fire a missile between two cities. */
  autoLaunch?: boolean
  autoLaunchInterval?: number
  maxActive?: number
  trailColor?: number
  impactColor?: number
}

export interface MissileSystem {
  launch: (launch: MissileLaunch) => void
  update: (deltaSeconds: number) => void
  setVisible: (visible: boolean) => void
  readonly count: number
  dispose: () => void
}

interface ActiveMissile {
  root: THREE.Object3D
  plumes: THREE.Object3D[]
  from: THREE.Vector3
  to: THREE.Vector3
  rotation: THREE.Quaternion
  apogee: number
  duration: number
  elapsed: number
  trail: THREE.Line
  trailPositions: Float32Array
  trailCount: number
}

interface Impact {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  elapsed: number
  duration: number
  baseScale: number
}

/**
 * Creates a system that fires ballistic missiles along great-circle arcs on the
 * globe: a powered boost phase, an exo-atmospheric coast, then re-entry and an
 * impact flash. Missiles are clones of the `public/models/icbm.glb` asset.
 */
export function createMissileSystem(options: MissileSystemOptions): MissileSystem {
  const scene = options.scene
  const globe = options.globe
  const assetUrl = options.assetUrl
  const modelPath = options.modelPath ?? 'models/icbm.glb'
  const defaultApogee = options.apogee ?? 0.22
  const defaultDuration = options.duration ?? 16
  const defaultScale = options.scale ?? 3
  const autoLaunch = options.autoLaunch ?? true
  const autoLaunchInterval = options.autoLaunchInterval ?? 6
  const maxActive = options.maxActive ?? 10
  const trailColor = options.trailColor ?? 0x7fe3ff
  const impactColor = options.impactColor ?? 0xaee8ff

  const loader = new GLTFLoader()
  const active: ActiveMissile[] = []
  const impacts: Impact[] = []
  const queued: MissileLaunch[] = []
  let template: THREE.Object3D | null = null
  let visible = true
  let disposed = false
  let autoTimer = autoLaunchInterval
  let lastCityIndex = 0

  const scratch = {
    quat: new THREE.Quaternion(),
    position: new THREE.Vector3(),
    ahead: new THREE.Vector3(),
    behind: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    ringQuat: new THREE.Quaternion(),
    ringNormal: new THREE.Vector3(0, 0, 1),
  }

  loader
    .loadAsync(assetUrl(modelPath))
    .then((gltf) => {
      if (disposed) return
      template = gltf.scene
      template.updateMatrixWorld(true)
      while (queued.length > 0) spawn(queued.shift() as MissileLaunch)
    })
    .catch((error: unknown) => {
      console.error(`[missiles] failed to load ${modelPath}`, error)
    })

  /** World position on the arc at parameter `t` in [0,1] for a missile. */
  function positionAt(missile: ActiveMissile, t: number, out: THREE.Vector3): THREE.Vector3 {
    const clamped = THREE.MathUtils.clamp(t, 0, 1)
    // Rotate the departure point toward the target along the great circle.
    scratch.quat.identity().slerp(missile.rotation, clamped)
    out.copy(missile.from).applyQuaternion(scratch.quat)
    const radius = GLOBE_RADIUS * (1 + missile.apogee * Math.sin(Math.PI * clamped))
    out.multiplyScalar(radius)
    return globe.localToWorld(out)
  }

  function spawn(launch: MissileLaunch): void {
    if (!template) return

    const from = geoToVector3(launch.fromLat, launch.fromLng)
    const to = geoToVector3(launch.toLat, launch.toLng)
    const rotation = new THREE.Quaternion().setFromUnitVectors(from, to)

    const root = template.clone(true)
    root.scale.setScalar(launch.scale ?? defaultScale)
    root.visible = visible
    scene.add(root)

    // Both the outer flame and its hot core belong to the boost phase.
    const plumes: THREE.Object3D[] = []
    for (const name of ['Flame', 'FlameCore']) {
      const node = root.getObjectByName(name)
      if (node) plumes.push(node)
    }

    const trailPositions = new Float32Array(TRAIL_POINTS * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
    geometry.setDrawRange(0, 0)

    const trail = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: trailColor,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    trail.frustumCulled = false
    trail.visible = visible
    scene.add(trail)

    active.push({
      root,
      plumes,
      from,
      to,
      rotation,
      apogee: defaultApogee,
      duration: Math.max(2, launch.duration ?? defaultDuration),
      elapsed: 0,
      trail,
      trailPositions,
      trailCount: 0,
    })
  }

  function launch(launchOptions: MissileLaunch): void {
    if (disposed) return
    if (!template) {
      queued.push(launchOptions)
      return
    }
    spawn(launchOptions)
  }

  function pushTrail(missile: ActiveMissile, point: THREE.Vector3): void {
    const { trailPositions, trailCount } = missile
    if (trailCount < TRAIL_POINTS) {
      const offset = trailCount * 3
      trailPositions[offset] = point.x
      trailPositions[offset + 1] = point.y
      trailPositions[offset + 2] = point.z
      missile.trailCount += 1
    } else {
      trailPositions.copyWithin(0, 3)
      const offset = (TRAIL_POINTS - 1) * 3
      trailPositions[offset] = point.x
      trailPositions[offset + 1] = point.y
      trailPositions[offset + 2] = point.z
    }

    const geometry = missile.trail.geometry
    geometry.setDrawRange(0, missile.trailCount)
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.needsUpdate = true
  }

  function detonate(at: THREE.Vector3): void {
    const normal = scratch.normal.copy(at).normalize()
    const material = new THREE.MeshBasicMaterial({
      color: impactColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 48), material)
    mesh.position.copy(at).addScaledVector(normal, 0.2)
    scratch.ringQuat.setFromUnitVectors(scratch.ringNormal, normal)
    mesh.quaternion.copy(scratch.ringQuat)
    mesh.scale.setScalar(defaultScale * 0.4)
    mesh.visible = visible
    scene.add(mesh)

    impacts.push({ mesh, material, elapsed: 0, duration: 0.9, baseScale: defaultScale * 0.4 })
  }

  function retarget(missile: ActiveMissile): void {
    scene.remove(missile.root)
    scene.remove(missile.trail)
    missile.trail.geometry.dispose()
    ;(missile.trail.material as THREE.Material).dispose()
  }

  function pickCities(): { from: { lat: number; lng: number }; to: { lat: number; lng: number } } {
    const from = HUBS[lastCityIndex % HUBS.length]
    lastCityIndex += 1
    let to = CITIES[Math.floor(Math.random() * CITIES.length)]
    let guard = 0
    while (to.name === from.name && guard < 8) {
      to = CITIES[Math.floor(Math.random() * CITIES.length)]
      guard += 1
    }
    return { from, to }
  }

  function update(deltaSeconds: number): void {
    if (disposed) return
    const dt = Math.min(deltaSeconds, 0.1)
    globe.updateWorldMatrix(true, false)

    if (autoLaunch && visible && template) {
      autoTimer -= dt
      if (autoTimer <= 0) {
        if (active.length < maxActive) {
          const { from, to } = pickCities()
          launch({ fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng })
        }
        autoTimer = autoLaunchInterval * (0.7 + Math.random() * 0.6)
      }
    }

    for (let i = active.length - 1; i >= 0; i -= 1) {
      const missile = active[i]
      missile.elapsed += dt
      const t = THREE.MathUtils.clamp(missile.elapsed / missile.duration, 0, 1)

      positionAt(missile, t, scratch.position)

      const eps = 0.004
      positionAt(missile, t - eps, scratch.behind)
      positionAt(missile, t + eps, scratch.ahead)
      scratch.velocity.copy(scratch.ahead).sub(scratch.behind)
      if (scratch.velocity.lengthSq() > 1e-10) {
        scratch.velocity.normalize()
        missile.root.quaternion.setFromUnitVectors(UP, scratch.velocity)
      }
      missile.root.position.copy(scratch.position)

      // Powered only during the brief boost phase; coasting and re-entry are inert.
      const powered = t < 0.16 && visible
      for (const plume of missile.plumes) plume.visible = powered

      if (visible) pushTrail(missile, scratch.position)

      if (t >= 1) {
        const impactPoint = scratch.position.clone()
        if (visible) detonate(impactPoint)
        retarget(missile)
        active.splice(i, 1)
      }
    }

    for (let i = impacts.length - 1; i >= 0; i -= 1) {
      const impact = impacts[i]
      impact.elapsed += dt
      const k = impact.elapsed / impact.duration
      if (k >= 1) {
        scene.remove(impact.mesh)
        impact.mesh.geometry.dispose()
        impact.material.dispose()
        impacts.splice(i, 1)
        continue
      }
      const eased = 1 - Math.pow(1 - k, 3)
      impact.mesh.scale.setScalar(impact.baseScale * (1 + eased * 12))
      impact.material.opacity = 0.9 * (1 - k)
    }
  }

  function setVisible(next: boolean): void {
    visible = next
    for (const missile of active) {
      missile.root.visible = next
      missile.trail.visible = next
      const powered = next && missile.elapsed / missile.duration < 0.16
      for (const plume of missile.plumes) plume.visible = powered
    }
    for (const impact of impacts) impact.mesh.visible = next
  }

  function dispose(): void {
    disposed = true
    for (const missile of active) retarget(missile)
    active.length = 0
    for (const impact of impacts) {
      scene.remove(impact.mesh)
      impact.mesh.geometry.dispose()
      impact.material.dispose()
    }
    impacts.length = 0
    queued.length = 0
    template = null
  }

  return {
    launch,
    update,
    setVisible,
    get count(): number {
      return active.length
    },
    dispose,
  }
}
