import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)
const TAU = Math.PI * 2

export interface ExplosionSystemOptions {
  /** Effects are parented to the globe so they stay anchored to the surface. */
  globe: THREE.Object3D
  /** Overall size multiplier (1 = ~34 unit column on a radius-100 globe). */
  scale?: number
  /** Seconds from detonation to fully dissipated. */
  duration?: number
  maxConcurrent?: number
  /** 'low' halves the particle counts for mobile. */
  quality?: 'high' | 'low'
}

export interface ExplosionSpawnOptions {
  /** Multiplier on top of the system scale (MIRV RVs use a little less). */
  scale?: number
}

export interface ExplosionSystem {
  spawn: (worldPosition: THREE.Vector3, options?: ExplosionSpawnOptions) => void
  update: (deltaSeconds: number) => void
  setVisible: (visible: boolean) => void
  readonly count: number
  dispose: () => void
}

interface Puff {
  sprite: THREE.Sprite
  kind: 'fire' | 'smoke'
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startScale: number
  endScale: number
  delay: number
  life: number
  baseOpacity: number
  colorStart: THREE.Color
  colorEnd: THREE.Color
}

interface RingSpec {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  from: number
  to: number
  delay: number
  life: number
  baseOpacity: number
}

interface Cloud {
  group: THREE.Group
  puffs: Puff[]
  rings: RingSpec[]
  elapsed: number
  duration: number
  scale: number
}

/** A soft, puffy radial sprite drawn to a canvas — no external assets. */
function makePuffTexture(fire: boolean): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  if (fire) {
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,232,168,0.95)')
    gradient.addColorStop(0.55, 'rgba(255,148,48,0.55)')
    gradient.addColorStop(1, 'rgba(255,80,0,0)')
  } else {
    gradient.addColorStop(0, 'rgba(255,255,255,0.92)')
    gradient.addColorStop(0.4, 'rgba(206,210,216,0.62)')
    gradient.addColorStop(0.75, 'rgba(120,124,132,0.3)')
    gradient.addColorStop(1, 'rgba(80,82,90,0)')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 14; i += 1) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.55
    const y = size / 2 + (Math.random() - 0.5) * size * 0.55
    const r = size * (0.08 + Math.random() * 0.16)
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, fire ? 'rgba(255,244,214,0.5)' : 'rgba(236,236,240,0.42)')
    blob.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = blob
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Mushroom-cloud detonations: a blinding flash, an expanding shockwave, a rising
 * fireball that flattens into a rolling cap, and a drawn-up stem with a ground
 * dust skirt. Puffs are camera-facing sprites, pooled and reused.
 */
export function createExplosionSystem(options: ExplosionSystemOptions): ExplosionSystem {
  const globe = options.globe
  const baseScale = options.scale ?? 1
  const duration = options.duration ?? 7
  const maxConcurrent = options.maxConcurrent ?? 6
  const quality = options.quality ?? 'high'
  const density = quality === 'low' ? 0.5 : 1

  const fireTexture = makePuffTexture(true)
  const smokeTexture = makePuffTexture(false)
  const disposables: Array<{ dispose: () => void }> = [fireTexture, smokeTexture]

  const clouds: Cloud[] = []
  const firePool: THREE.Sprite[] = []
  const smokePool: THREE.Sprite[] = []
  const ringPool: THREE.Mesh[] = []
  let visible = true
  let disposed = false

  const ringGeometry = new THREE.RingGeometry(0.9, 1, 64)
  disposables.push(ringGeometry)

  const scratchA = new THREE.Vector3()

  function createSprite(kind: 'fire' | 'smoke'): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: kind === 'fire' ? fireTexture : smokeTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: kind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    disposables.push(material)
    const sprite = new THREE.Sprite(material)
    sprite.frustumCulled = false
    sprite.visible = false
    return sprite
  }

  function acquire(kind: 'fire' | 'smoke'): THREE.Sprite {
    const pool = kind === 'fire' ? firePool : smokePool
    const sprite = pool.pop()
    if (sprite) return sprite
    return createSprite(kind)
  }

  function release(sprite: THREE.Sprite, kind: 'fire' | 'smoke'): void {
    sprite.visible = false
    sprite.removeFromParent()
    ;(kind === 'fire' ? firePool : smokePool).push(sprite)
  }

  function acquireRing(): THREE.Mesh {
    const mesh = ringPool.pop()
    if (mesh) return mesh
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    disposables.push(material)
    const created = new THREE.Mesh(ringGeometry, material)
    created.frustumCulled = false
    created.visible = false
    // Lay the ring flat in the group's XZ plane (group +Y is the surface normal).
    created.rotation.x = -Math.PI / 2
    return created
  }

  function releaseRing(mesh: THREE.Mesh): void {
    mesh.visible = false
    mesh.removeFromParent()
    ringPool.push(mesh)
  }

  function addPuff(
    group: THREE.Group,
    puffs: Puff[],
    kind: 'fire' | 'smoke',
    config: {
      startPos: THREE.Vector3
      endPos: THREE.Vector3
      startScale: number
      endScale: number
      delay: number
      life: number
      baseOpacity: number
      colorStart: THREE.Color
      colorEnd: THREE.Color
    },
  ): void {
    const sprite = acquire(kind)
    sprite.position.copy(config.startPos)
    sprite.material.color.copy(config.colorStart)
    sprite.material.opacity = 0
    sprite.visible = visible
    group.add(sprite)
    puffs.push({ sprite, kind, ...config })
  }

  function buildCloud(scale: number): Cloud {
    const group = new THREE.Group()
    group.name = 'Detonation'
    const puffs: Puff[] = []
    const rings: RingSpec[] = []

    const height = 36 * scale
    const capRadius = 13 * scale
    const stemRadius = 4.5 * scale
    const dustRadius = 15 * scale

    const fireColorStart = new THREE.Color(0xfff6dd)
    const fireColorEnd = new THREE.Color(0xff5a18)
    const smokeStart = new THREE.Color(0xd2d6dc)
    const smokeEnd = new THREE.Color(0x4b4e57)
    const dustStart = new THREE.Color(0xbba383)
    const dustEnd = new THREE.Color(0x6d6c74)

    const rand = (min: number, max: number): number => min + Math.random() * (max - min)
    const azimuth = (): number => Math.random() * TAU

    // Blinding flash (a very large, very short fire puff).
    addPuff(group, puffs, 'fire', {
      startPos: new THREE.Vector3(0, 5 * scale, 0),
      endPos: new THREE.Vector3(0, 9 * scale, 0),
      startScale: 9 * scale,
      endScale: 62 * scale,
      delay: 0,
      life: 0.3,
      baseOpacity: 1,
      colorStart: new THREE.Color(0xffffff),
      colorEnd: new THREE.Color(0xffd9a0),
    })

    // Fireball puffs rising into the cap.
    const fireCount = Math.round(10 * density)
    for (let i = 0; i < fireCount; i += 1) {
      const angle = azimuth()
      const radius = capRadius * rand(0.2, 0.55)
      addPuff(group, puffs, 'fire', {
        startPos: new THREE.Vector3(Math.cos(angle) * 2 * scale, rand(2, 4) * scale, Math.sin(angle) * 2 * scale),
        endPos: new THREE.Vector3(
          Math.cos(angle) * radius,
          height * rand(0.72, 0.92),
          Math.sin(angle) * radius,
        ),
        startScale: rand(7, 10) * scale,
        endScale: rand(11, 15) * scale,
        delay: rand(0, 0.12),
        life: rand(0.45, 0.7),
        baseOpacity: 0.95,
        colorStart: fireColorStart,
        colorEnd: fireColorEnd,
      })
    }

    // Rolling cap.
    const capCount = Math.round(14 * density)
    for (let i = 0; i < capCount; i += 1) {
      const angle = azimuth()
      const radius = capRadius * rand(0.55, 1)
      addPuff(group, puffs, 'smoke', {
        startPos: new THREE.Vector3(
          Math.cos(angle) * stemRadius * 0.4,
          height * rand(0.5, 0.66),
          Math.sin(angle) * stemRadius * 0.4,
        ),
        endPos: new THREE.Vector3(Math.cos(angle) * radius, height * rand(0.9, 1.06), Math.sin(angle) * radius),
        startScale: rand(8, 11) * scale,
        endScale: rand(12, 16) * scale,
        delay: rand(0.15, 0.4),
        life: rand(0.55, 0.9),
        baseOpacity: 0.55,
        colorStart: smokeStart,
        colorEnd: smokeEnd,
      })
    }

    // Stem drawn up from ground zero (must reach the cap so it reads as a mushroom).
    const stemCount = Math.round(12 * density)
    for (let i = 0; i < stemCount; i += 1) {
      const angle = azimuth()
      const radius = stemRadius * rand(0.1, 0.5)
      addPuff(group, puffs, 'smoke', {
        startPos: new THREE.Vector3(Math.cos(angle) * 1.5 * scale, rand(1, 3) * scale, Math.sin(angle) * 1.5 * scale),
        endPos: new THREE.Vector3(
          Math.cos(angle) * radius,
          height * rand(0.6, 0.85),
          Math.sin(angle) * radius,
        ),
        startScale: rand(6, 8) * scale,
        endScale: rand(9, 13) * scale,
        delay: rand(0.04, 0.28),
        life: rand(0.5, 0.85),
        baseOpacity: 0.45,
        colorStart: smokeStart.clone(),
        colorEnd: smokeEnd.clone(),
      })
    }

    // Ground dust skirt.
    const dustCount = Math.round(6 * density)
    for (let i = 0; i < dustCount; i += 1) {
      const angle = azimuth()
      const radius = dustRadius * rand(0.5, 0.95)
      addPuff(group, puffs, 'smoke', {
        startPos: new THREE.Vector3(Math.cos(angle) * 2 * scale, 1.5 * scale, Math.sin(angle) * 2 * scale),
        endPos: new THREE.Vector3(Math.cos(angle) * radius, rand(2, 5) * scale, Math.sin(angle) * radius),
        startScale: rand(7, 10) * scale,
        endScale: rand(12, 16) * scale,
        delay: rand(0, 0.1),
        life: rand(0.3, 0.5),
        baseOpacity: 0.32,
        colorStart: dustStart.clone(),
        colorEnd: dustEnd.clone(),
      })
    }

    // Shockwave + dust rings.
    const ringConfigs = [
      { from: 1.5, to: 15, delay: 0, life: 0.35, baseOpacity: 0.85, color: 0xffe6b8 },
      { from: 2.5, to: 24, delay: 0.05, life: 0.5, baseOpacity: 0.24, color: 0xa9c2d8 },
    ]
    for (const config of ringConfigs) {
      const mesh = acquireRing()
      ;(mesh.material as THREE.MeshBasicMaterial).color.setHex(config.color)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
      mesh.position.set(0, 0.6 * scale, 0)
      mesh.scale.setScalar(config.from * scale)
      mesh.visible = visible
      group.add(mesh)
      rings.push({
        mesh,
        material: mesh.material as THREE.MeshBasicMaterial,
        from: config.from * scale,
        to: config.to * scale,
        delay: config.delay,
        life: config.life,
        baseOpacity: config.baseOpacity,
      })
    }

    return { group, puffs, rings, elapsed: 0, duration, scale }
  }

  function teardown(cloud: Cloud): void {
    for (const puff of cloud.puffs) release(puff.sprite, puff.kind)
    for (const ring of cloud.rings) releaseRing(ring.mesh)
    globe.remove(cloud.group)
  }

  function spawn(worldPosition: THREE.Vector3, spawnOptions?: ExplosionSpawnOptions): void {
    if (disposed || !visible) return

    if (clouds.length >= maxConcurrent) {
      const oldest = clouds.shift() as Cloud
      teardown(oldest)
    }

    const local = globe.worldToLocal(scratchA.copy(worldPosition)).clone()
    const normal = local.clone().normalize()

    const scale = baseScale * (spawnOptions?.scale ?? 1)
    const cloud = buildCloud(scale)
    cloud.group.position.copy(local)
    cloud.group.quaternion.setFromUnitVectors(UP, normal)
    cloud.group.visible = visible
    globe.add(cloud.group)
    clouds.push(cloud)
  }

  function update(deltaSeconds: number): void {
    if (disposed) return
    const dt = Math.min(deltaSeconds, 0.1)

    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i]
      cloud.elapsed += dt
      const t = cloud.elapsed / cloud.duration
      if (t >= 1) {
        teardown(cloud)
        clouds.splice(i, 1)
        continue
      }

      for (const puff of cloud.puffs) {
        const life = THREE.MathUtils.clamp((t - puff.delay) / puff.life, 0, 1)
        if (life <= 0) {
          puff.sprite.visible = false
          continue
        }
        puff.sprite.visible = visible
        const eased = 1 - Math.pow(1 - life, 2)
        puff.sprite.position.lerpVectors(puff.startPos, puff.endPos, eased)
        const size = THREE.MathUtils.lerp(puff.startScale, puff.endScale, eased)
        puff.sprite.scale.set(size, size, 1)
        const fadeIn = Math.min(1, life / 0.18)
        const fadeOut = 1 - Math.max(0, (life - 0.55) / 0.45)
        puff.sprite.material.opacity = puff.baseOpacity * fadeIn * THREE.MathUtils.clamp(fadeOut, 0, 1)
        puff.sprite.material.color.lerpColors(puff.colorStart, puff.colorEnd, life)
      }

      for (const ring of cloud.rings) {
        const life = THREE.MathUtils.clamp((t - ring.delay) / ring.life, 0, 1)
        if (life <= 0) {
          ring.mesh.visible = false
          continue
        }
        ring.mesh.visible = visible
        const eased = 1 - Math.pow(1 - life, 3)
        ring.mesh.scale.setScalar(THREE.MathUtils.lerp(ring.from, ring.to, eased))
        ring.material.opacity = ring.baseOpacity * (1 - life)
      }
    }
  }

  function setVisible(next: boolean): void {
    visible = next
    for (const cloud of clouds) {
      cloud.group.visible = next
      for (const puff of cloud.puffs) puff.sprite.visible = next && puff.sprite.material.opacity > 0.001
      for (const ring of cloud.rings) ring.mesh.visible = next
    }
  }

  function dispose(): void {
    disposed = true
    for (const cloud of clouds) teardown(cloud)
    clouds.length = 0
    for (const item of disposables) item.dispose()
    firePool.length = 0
    smokePool.length = 0
    ringPool.length = 0
  }

  return {
    spawn,
    update,
    setVisible,
    get count(): number {
      return clouds.length
    },
    dispose,
  }
}
