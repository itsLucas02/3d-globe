import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { geoToVector3 } from './globeMaterial'
import { GLOBE_RADIUS } from './constants'
import { CITIES, HUBS } from './globeData'

const UP = new THREE.Vector3(0, 1, 0)
const TRAIL_POINTS = 96
const RV_NODE_NAMES = ['RV_1', 'RV_2', 'RV_3']
/** Per-RV target offsets in degrees (lat, lng) around the primary aim point. */
const RV_OFFSETS: Array<[number, number]> = [
  [-1.6, -1.1],
  [1.7, -0.4],
  [0.1, 1.7],
]

export type MissileVariant = 'icbm' | 'mirv'

export interface MissileLaunch {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
  /** Seconds from lift-off to impact. */
  duration?: number
  /** Model length in world units (the meshes are authored 1 unit long). */
  scale?: number
  variant?: MissileVariant
  /** Apogee as a fraction of the globe radius (ICBM only). */
  apogee?: number
}

export interface MissileSystemOptions {
  scene: THREE.Scene
  /** The globe object; surface positions are placed through its world transform. */
  globe: THREE.Object3D
  /** BASE_URL-aware asset resolver (see main.ts). */
  assetUrl: (path: string) => string
  icbmPath?: string
  mirvPath?: string
  apogee?: number
  duration?: number
  scale?: number
  /** Fraction of the MIRV flight at which the bus releases its RVs. */
  deployFraction?: number
  /** Seconds for a released RV to reach its own target. */
  rvDuration?: number
  /** Multiplier on the built-in RV target spread (degrees). */
  rvSpread?: number
  /** Periodically fire a missile between two cities. */
  autoLaunch?: boolean
  autoLaunchInterval?: number
  maxActive?: number
  trailColor?: number
  rvTrailColor?: number
  impactColor?: number
  /**
   * Called at each impact with the world position and outward surface normal.
   * When provided it replaces the built-in ring flash, so a richer effect
   * (see explosions.ts) can own the detonation.
   */
  onImpact?: (position: THREE.Vector3, normal: THREE.Vector3, scale?: number) => void
}

export interface MissileSystem {
  launch: (launch: MissileLaunch) => void
  update: (deltaSeconds: number) => void
  setVisible: (visible: boolean) => void
  readonly count: number
  dispose: () => void
}

type Path =
  | { kind: 'greatCircle'; from: THREE.Vector3; to: THREE.Vector3; rotation: THREE.Quaternion; apogee: number }
  | { kind: 'segment'; a: THREE.Vector3; b: THREE.Vector3; control: THREE.Vector3 }

interface Unit {
  root: THREE.Object3D
  plumes: THREE.Object3D[]
  path: Path
  duration: number
  elapsed: number
  scale: number
  trail: THREE.Line
  trailPositions: Float32Array
  trailCount: number
  /** Suppress the impact flash (used by spent boosters). */
  silent: boolean
  deployed: boolean
  targetLat: number
  targetLng: number
  isMirv: boolean
  /** Relative size of the detonation effect (RVs are a little smaller). */
  blastScale: number
}

interface Impact {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  elapsed: number
  duration: number
  baseScale: number
}

/**
 * Fires ballistic missiles along great-circle arcs on the globe: a powered boost
 * phase, an exo-atmospheric coast, then re-entry and an impact flash.
 *
 * A `mirv` launch flies a bus-carrying stack and, part-way through, releases
 * three independent re-entry vehicles that fan out to separate targets.
 */
export function createMissileSystem(options: MissileSystemOptions): MissileSystem {
  const scene = options.scene
  const globe = options.globe
  const assetUrl = options.assetUrl
  const icbmPath = options.icbmPath ?? 'models/icbm.glb'
  const mirvPath = options.mirvPath ?? 'models/mirv.glb'
  const defaultApogee = options.apogee ?? 0.22
  const defaultDuration = options.duration ?? 16
  const defaultScale = options.scale ?? 3
  const deployFraction = options.deployFraction ?? 0.42
  const rvDuration = options.rvDuration ?? 6
  const rvSpread = options.rvSpread ?? 1
  const autoLaunch = options.autoLaunch ?? true
  const autoLaunchInterval = options.autoLaunchInterval ?? 6.5
  const maxActive = options.maxActive ?? 12
  const trailColor = options.trailColor ?? 0x7fe3ff
  const rvTrailColor = options.rvTrailColor ?? 0xffb37f
  const impactColor = options.impactColor ?? 0xaee8ff
  const onImpact = options.onImpact

  const active: Unit[] = []
  const impacts: Impact[] = []
  const queued: MissileLaunch[] = []
  let icbmTemplate: THREE.Object3D | null = null
  let mirvTemplate: THREE.Object3D | null = null
  let rvProto: THREE.Object3D | null = null
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
    tempA: new THREE.Vector3(),
    tempB: new THREE.Vector3(),
  }

  const loader = new GLTFLoader()

  loader
    .loadAsync(assetUrl(icbmPath))
    .then((gltf) => {
      if (disposed) return
      icbmTemplate = gltf.scene
      icbmTemplate.updateMatrixWorld(true)
      flushQueue()
    })
    .catch((error: unknown) => console.error(`[missiles] failed to load ${icbmPath}`, error))

  loader
    .loadAsync(assetUrl(mirvPath))
    .then((gltf) => {
      if (disposed) return
      mirvTemplate = gltf.scene
      mirvTemplate.updateMatrixWorld(true)
      const rv = mirvTemplate.getObjectByName(RV_NODE_NAMES[0])
      if (rv) {
        // A standalone RV, origin at its base, nose along +Y.
        rvProto = rv.clone(true)
        rvProto.position.set(0, 0, 0)
        rvProto.quaternion.identity()
        rvProto.scale.set(1, 1, 1)
      }
    })
    .catch((error: unknown) => console.error(`[missiles] failed to load ${mirvPath}`, error))

  function flushQueue(): void {
    while (queued.length > 0) {
      const next = queued.shift() as MissileLaunch
      spawn(next)
    }
  }

  function makeTrail(color: number): Pick<Unit, 'trail' | 'trailPositions' | 'trailCount'> {
    const trailPositions = new Float32Array(TRAIL_POINTS * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
    geometry.setDrawRange(0, 0)
    const trail = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    trail.frustumCulled = false
    trail.visible = visible
    scene.add(trail)
    return { trail, trailPositions, trailCount: 0 }
  }

  function spawn(launch: MissileLaunch): void {
    const variant: MissileVariant = launch.variant ?? 'icbm'
    const isMirv = variant === 'mirv' && mirvTemplate !== null
    const template = isMirv ? (mirvTemplate as THREE.Object3D) : icbmTemplate
    if (!template) return

    const from = geoToVector3(launch.fromLat, launch.fromLng)
    const to = geoToVector3(launch.toLat, launch.toLng)
    const rotation = new THREE.Quaternion().setFromUnitVectors(from, to)

    const root = template.clone(true)
    root.scale.setScalar(launch.scale ?? defaultScale)
    root.visible = visible
    scene.add(root)

    const plumes: THREE.Object3D[] = []
    for (const name of ['Flame', 'FlameCore']) {
      const node = root.getObjectByName(name)
      if (node) plumes.push(node)
    }

    active.push({
      root,
      plumes,
      path: { kind: 'greatCircle', from, to, rotation, apogee: launch.apogee ?? defaultApogee },
      duration: Math.max(2, launch.duration ?? defaultDuration),
      elapsed: 0,
      scale: launch.scale ?? defaultScale,
      ...makeTrail(trailColor),
      silent: false,
      deployed: false,
      targetLat: launch.toLat,
      targetLng: launch.toLng,
      isMirv,
      blastScale: 1,
    })
  }

  function launch(launchOptions: MissileLaunch): void {
    if (disposed) return
    if (!icbmTemplate) {
      queued.push(launchOptions)
      return
    }
    spawn(launchOptions)
  }

  function positionAt(unit: Unit, t: number, out: THREE.Vector3): THREE.Vector3 {
    const clamped = THREE.MathUtils.clamp(t, 0, 1)
    const path = unit.path
    if (path.kind === 'greatCircle') {
      scratch.quat.identity().slerp(path.rotation, clamped)
      out.copy(path.from).applyQuaternion(scratch.quat)
      out.multiplyScalar(GLOBE_RADIUS * (1 + path.apogee * Math.sin(Math.PI * clamped)))
      return globe.localToWorld(out)
    }
    // Quadratic Bezier through space (used by released RVs).
    const inv = 1 - clamped
    out.copy(path.a).multiplyScalar(inv * inv)
    out.addScaledVector(path.control, 2 * inv * clamped)
    out.addScaledVector(path.b, clamped * clamped)
    return out
  }

  function detonate(at: THREE.Vector3, blastScale: number): void {
    const normal = scratch.normal.copy(at).normalize()

    if (onImpact) {
      onImpact(at, normal, blastScale)
      return
    }

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

  function retire(unit: Unit): void {
    scene.remove(unit.root)
    scene.remove(unit.trail)
    unit.trail.geometry.dispose()
    ;(unit.trail.material as THREE.Material).dispose()
  }

  /** Release the MIRV bus: detach each RV node into its own independent flight. */
  function deploy(unit: Unit): void {
    unit.deployed = true
    unit.silent = true
    unit.root.updateWorldMatrix(true, true)

    for (let i = 0; i < RV_NODE_NAMES.length; i += 1) {
      const node = unit.root.getObjectByName(RV_NODE_NAMES[i])
      if (!node || !rvProto) continue

      const start = new THREE.Vector3()
      node.getWorldPosition(start)
      node.visible = false

      const offset = RV_OFFSETS[i % RV_OFFSETS.length]
      const target = geoToVector3(unit.targetLat + offset[0] * rvSpread, unit.targetLng + offset[1] * rvSpread)
      target.multiplyScalar(GLOBE_RADIUS)
      globe.localToWorld(target)

      const control = scratch.tempA.copy(start).add(target).multiplyScalar(0.5)
      const chord = start.distanceTo(target)
      scratch.tempB.copy(control).normalize()
      control.addScaledVector(scratch.tempB, chord * 0.22)

      const rv = rvProto.clone(true)
      rv.scale.setScalar(unit.scale)
      rv.visible = visible
      scene.add(rv)

      active.push({
        root: rv,
        plumes: [],
        path: { kind: 'segment', a: start, b: target.clone(), control: control.clone() },
        duration: rvDuration,
        elapsed: 0,
        scale: unit.scale,
        ...makeTrail(rvTrailColor),
        silent: false,
        deployed: true,
        targetLat: unit.targetLat,
        targetLng: unit.targetLng,
        isMirv: false,
        blastScale: 0.75,
      })
    }
  }

  function pushTrail(unit: Unit, point: THREE.Vector3): void {
    const { trailPositions } = unit
    if (unit.trailCount < TRAIL_POINTS) {
      const offset = unit.trailCount * 3
      trailPositions[offset] = point.x
      trailPositions[offset + 1] = point.y
      trailPositions[offset + 2] = point.z
      unit.trailCount += 1
    } else {
      trailPositions.copyWithin(0, 3)
      const offset = (TRAIL_POINTS - 1) * 3
      trailPositions[offset] = point.x
      trailPositions[offset + 1] = point.y
      trailPositions[offset + 2] = point.z
    }
    const geometry = unit.trail.geometry
    geometry.setDrawRange(0, unit.trailCount)
    ;(geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
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

    if (autoLaunch && visible && icbmTemplate) {
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
      const unit = active[i]
      unit.elapsed += dt
      const t = THREE.MathUtils.clamp(unit.elapsed / unit.duration, 0, 1)

      positionAt(unit, t, scratch.position)

      const eps = 0.004
      positionAt(unit, t - eps, scratch.behind)
      positionAt(unit, t + eps, scratch.ahead)
      scratch.velocity.copy(scratch.ahead).sub(scratch.behind)
      if (scratch.velocity.lengthSq() > 1e-10) {
        scratch.velocity.normalize()
        unit.root.quaternion.setFromUnitVectors(UP, scratch.velocity)
      }
      unit.root.position.copy(scratch.position)

      // The bus separates part-way through a MIRV flight.
      if (unit.isMirv && !unit.deployed && t >= deployFraction) deploy(unit)

      // Boosters burn only during the brief boost phase; RVs never burn.
      const powered = unit.plumes.length > 0 && t < 0.16 && visible
      for (const plume of unit.plumes) plume.visible = powered

      if (visible) pushTrail(unit, scratch.position)

      if (t >= 1) {
        const impactPoint = scratch.position.clone()
        if (visible && !unit.silent) detonate(impactPoint, unit.blastScale)
        retire(unit)
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
    for (const unit of active) {
      unit.root.visible = next
      unit.trail.visible = next
      const powered = next && unit.plumes.length > 0 && unit.elapsed / unit.duration < 0.16
      for (const plume of unit.plumes) plume.visible = powered
    }
    for (const impact of impacts) impact.mesh.visible = next
  }

  function dispose(): void {
    disposed = true
    for (const unit of active) retire(unit)
    active.length = 0
    for (const impact of impacts) {
      scene.remove(impact.mesh)
      impact.mesh.geometry.dispose()
      impact.material.dispose()
    }
    impacts.length = 0
    queued.length = 0
    icbmTemplate = null
    mirvTemplate = null
    rvProto = null
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
