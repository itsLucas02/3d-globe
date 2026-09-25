import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)
const TAU = Math.PI * 2

export interface ExplosionSystemOptions {
  /** Effects are parented to the globe so they stay anchored to the surface. */
  globe: THREE.Object3D
  /** Used to light the puffs from the same direction as the Earth. */
  camera?: THREE.Camera
  /** World-space direction toward the sun (matches the globe's day/night shader). */
  getSunDirection?: () => THREE.Vector3
  /** Overall size multiplier (1 = ~44 unit column on a radius-100 globe). */
  scale?: number
  /** Seconds from detonation to fully dissipated. */
  duration?: number
  maxConcurrent?: number
  /** 'low' thins the puff counts for mobile. */
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

interface PuffDef {
  start: THREE.Vector3
  end: THREE.Vector3
  scaleStart: number
  scaleEnd: number
  delay: number
  life: number
  opacity: number
  spin: number
  lit: THREE.Color
  litHot: THREE.Color
  shade: THREE.Color
  shadeHot: THREE.Color
  glow: THREE.Color
}

interface Cloud {
  group: THREE.Group
  mesh: THREE.Mesh
  geometry: THREE.InstancedBufferGeometry
  material: THREE.ShaderMaterial
  flash: THREE.Mesh
  flashMaterial: THREE.MeshBasicMaterial
  rings: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; from: number; to: number; delay: number; life: number; opacity: number }>
  elapsed: number
  duration: number
  baseScale: number
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 iPosStart;
  attribute vec3 iPosEnd;
  attribute vec2 iScale;
  attribute vec3 iTiming;
  attribute vec2 iRot;
  attribute vec3 iLit;
  attribute vec3 iLitHot;
  attribute vec3 iShade;
  attribute vec3 iShadeHot;
  attribute vec3 iGlow;

  uniform float uTime;
  uniform float uForm;

  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vLit;
  varying vec3 vShade;
  varying vec3 vGlow;

  void main() {
    float age = uTime - iTiming.x;
    float t = clamp(age / max(iTiming.y, 0.0001), 0.0, 1.0);
    // Formation is shared by every puff so the column rises together; each
    // puff then lives its own (much longer) life and dissipates in place.
    float form = clamp(age / uForm, 0.0, 1.0);
    float rise = 1.0 - pow(1.0 - form, 2.2);

    vec3 center = mix(iPosStart, iPosEnd, rise);
    float size = mix(iScale.x, iScale.y, rise);

    float ang = iRot.x + iRot.y * age;
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 p = position.xy;
    p = mat2(ca, -sa, sa, ca) * p * size;

    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    mv.xy += p;
    gl_Position = projectionMatrix * mv;

    vUv = uv;
    float fadeIn = smoothstep(0.0, 0.12, t);
    float fadeOut = 1.0 - smoothstep(0.6, 1.0, t);
    vOpacity = iTiming.z * fadeIn * fadeOut;

    float heat = 1.0 - smoothstep(0.0, 0.5, age);
    vLit = mix(iLitHot, iLit, 1.0 - heat);
    vShade = mix(iShadeHot, iShade, 1.0 - heat);
    vGlow = iGlow * heat;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uNoise;
  uniform vec3 uLightDirView;

  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vLit;
  varying vec3 vShade;
  varying vec3 vGlow;

  void main() {
    float n = texture2D(uNoise, vUv).a;
    float alpha = n * vOpacity;
    if (alpha < 0.004) discard;

    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float z = sqrt(max(1.0 - r2, 0.0));

    // Treat the billboard as a squashed sphere so the puff gets a lit side.
    vec3 nrm = normalize(vec3(q.x, q.y, z + 0.35));
    // Wrapped (half-Lambert) lighting so a back-lit cloud never crushes to
    // black against space, plus a rim term where the billboard turns edge-on.
    float wrap = pow(clamp(dot(nrm, uLightDirView) * 0.5 + 0.5, 0.0, 1.0), 1.6);
    float shade = mix(0.3, 1.0, wrap);
    float rim = pow(1.0 - z, 2.0) * 0.25;

    vec3 col = mix(vShade, vLit, shade);
    col += vLit * rim;
    col += vGlow * (0.35 + 0.65 * z);

    gl_FragColor = vec4(col, alpha);
  }
`

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise(x * freq, y * freq)
    freq *= 2.03
    amp *= 0.5
  }
  return sum
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * A turbulent, soft-edged puff mask in the alpha channel. RGB stays 1.0 — the
 * shader supplies the colour — so the same texture reads as smoke, fire or dust.
 */
function makePuffTexture(): THREE.DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const cx = u - 0.5
      const cy = v - 0.5
      const r = Math.sqrt(cx * cx + cy * cy) * 2

      const radial = 1 - smoothstep(0.05, 0.92, r)
      const detail = fbm(u * 3.6 + 11.7, v * 3.6 + 4.3, 6)
      const large = fbm(u * 1.3 + 61.2, v * 1.3 + 23.9, 3)

      let a = radial * (0.05 + 1.15 * detail) * (0.5 + 0.9 * large)
      a = smoothstep(0.04, 0.78, a)
      a *= radial

      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(THREE.MathUtils.clamp(a, 0, 1) * 255)
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function lin(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b)
}

/**
 * Nuclear detonations: a blinding flash, expanding ground shockwaves, a rising
 * incandescent fireball that flattens into a wind-sheared cap, a drawn-up stem
 * and a rolling dust skirt. The smoke is lit by the globe's own sun direction so
 * it sits in the same light as the Earth, rather than glowing uniformly.
 */
export function createExplosionSystem(options: ExplosionSystemOptions): ExplosionSystem {
  const globe = options.globe
  const camera = options.camera
  const getSunDirection = options.getSunDirection
  const baseScale = options.scale ?? 1
  const duration = options.duration ?? 10
  const maxConcurrent = options.maxConcurrent ?? 6
  const quality = options.quality ?? 'high'
  const density = quality === 'low' ? 0.5 : 1

  const noiseTexture = makePuffTexture()
  const clouds: Cloud[] = []
  const lightUniform = { value: new THREE.Vector3(0.4, 0.7, 0.6) }
  const sunWorld = new THREE.Vector3(0, 1, 0)
  let visible = true
  let disposed = false

  const scratchLocal = new THREE.Vector3()
  const scratchNormal = new THREE.Vector3()
  const scratchQuat = new THREE.Quaternion()

  function makeCloudGeometry(puffs: PuffDef[]): THREE.InstancedBufferGeometry {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])

    const count = puffs.length
    const posStart = new Float32Array(count * 3)
    const posEnd = new Float32Array(count * 3)
    const scales = new Float32Array(count * 2)
    const timings = new Float32Array(count * 3)
    const rots = new Float32Array(count * 2)
    const lit = new Float32Array(count * 3)
    const litHot = new Float32Array(count * 3)
    const shade = new Float32Array(count * 3)
    const shadeHot = new Float32Array(count * 3)
    const glow = new Float32Array(count * 3)

    puffs.forEach((puff, i) => {
      const p = i * 3
      posStart[p] = puff.start.x
      posStart[p + 1] = puff.start.y
      posStart[p + 2] = puff.start.z
      posEnd[p] = puff.end.x
      posEnd[p + 1] = puff.end.y
      posEnd[p + 2] = puff.end.z

      scales[i * 2] = puff.scaleStart
      scales[i * 2 + 1] = puff.scaleEnd

      timings[p] = puff.delay
      timings[p + 1] = puff.life
      timings[p + 2] = puff.opacity

      rots[i * 2] = Math.random() * TAU
      rots[i * 2 + 1] = puff.spin

      lit[p] = puff.lit.r
      lit[p + 1] = puff.lit.g
      lit[p + 2] = puff.lit.b
      litHot[p] = puff.litHot.r
      litHot[p + 1] = puff.litHot.g
      litHot[p + 2] = puff.litHot.b
      shade[p] = puff.shade.r
      shade[p + 1] = puff.shade.g
      shade[p + 2] = puff.shade.b
      shadeHot[p] = puff.shadeHot.r
      shadeHot[p + 1] = puff.shadeHot.g
      shadeHot[p + 2] = puff.shadeHot.b
      glow[p] = puff.glow.r
      glow[p + 1] = puff.glow.g
      glow[p + 2] = puff.glow.b
    })

    geometry.setAttribute('iPosStart', new THREE.InstancedBufferAttribute(posStart, 3))
    geometry.setAttribute('iPosEnd', new THREE.InstancedBufferAttribute(posEnd, 3))
    geometry.setAttribute('iScale', new THREE.InstancedBufferAttribute(scales, 2))
    geometry.setAttribute('iTiming', new THREE.InstancedBufferAttribute(timings, 3))
    geometry.setAttribute('iRot', new THREE.InstancedBufferAttribute(rots, 2))
    geometry.setAttribute('iLit', new THREE.InstancedBufferAttribute(lit, 3))
    geometry.setAttribute('iLitHot', new THREE.InstancedBufferAttribute(litHot, 3))
    geometry.setAttribute('iShade', new THREE.InstancedBufferAttribute(shade, 3))
    geometry.setAttribute('iShadeHot', new THREE.InstancedBufferAttribute(shadeHot, 3))
    geometry.setAttribute('iGlow', new THREE.InstancedBufferAttribute(glow, 3))
    geometry.instanceCount = count
    return geometry
  }

  function buildCloud(scale: number): Cloud {
    const group = new THREE.Group()
    group.name = 'Detonation'

    const puffs: PuffDef[] = []
    const rand = (min: number, max: number): number => min + Math.random() * (max - min)

    const height = 78 * scale
    const capRadius = 30 * scale
    const stemRadius = 5.5 * scale
    const dustRadius = 30 * scale
    const windAngle = Math.random() * TAU
    const windMag = 0.35 + Math.random() * 0.25
    const windX = Math.cos(windAngle) * windMag
    const windZ = Math.sin(windAngle) * windMag

    const smokeLit = lin(0.55, 0.53, 0.5)
    const smokeLitHot = lin(0.95, 0.89, 0.82)
    const smokeShade = lin(0.03, 0.035, 0.045)
    const smokeShadeHot = lin(0.28, 0.27, 0.27)
    const noGlow = lin(0, 0, 0)
    const dustLit = lin(0.56, 0.45, 0.31)
    const dustLitHot = lin(0.7, 0.55, 0.37)
    const dustShade = lin(0.1, 0.08, 0.06)
    const dustShadeHot = lin(0.24, 0.19, 0.13)

    const fireLit = lin(1.3, 0.44, 0.11)
    const fireLitHot = lin(3.6, 2.9, 2.0)
    const fireShade = lin(0.5, 0.12, 0.03)
    const fireShadeHot = lin(1.4, 0.62, 0.2)
    const fireGlow = lin(1.7, 0.72, 0.24)

    const emit = (puff: PuffDef): void => {
      // Per-puff brightness variation, plus a baked vertical gradient: the top
      // of the column is sunlit while the stalk sits in its own shadow.
      const variation = 0.78 + Math.random() * 0.4
      const hNorm = THREE.MathUtils.clamp(puff.end.y / height, 0, 1)
      const vertical = THREE.MathUtils.lerp(0.38, 1.06, hNorm)
      const k = variation * vertical
      puff.lit = puff.lit.clone().multiplyScalar(k)
      puff.litHot = puff.litHot.clone().multiplyScalar(variation)
      puff.shade = puff.shade.clone().multiplyScalar(THREE.MathUtils.lerp(0.35, 1, hNorm))
      puff.shadeHot = puff.shadeHot.clone().multiplyScalar(variation)
      puffs.push(puff)
    }

    // Ground shockwave + fast dust rings (drawn separately, below).
    // Fireball: incandescent, rises and boils, then cools through deep orange.
    const fireCount = Math.round(36 * density)
    for (let i = 0; i < fireCount; i += 1) {
      const angle = Math.random() * TAU
      const spread = Math.random() * 3.2 * scale
      emit({
        start: new THREE.Vector3(Math.cos(angle) * spread, rand(2, 7) * scale, Math.sin(angle) * spread),
        end: new THREE.Vector3(
          Math.cos(angle) * capRadius * rand(0.1, 0.45) + windX * height * 0.6,
          height * rand(0.72, 0.98),
          Math.sin(angle) * capRadius * rand(0.1, 0.45) + windZ * height * 0.6,
        ),
        scaleStart: rand(10, 15) * scale,
        scaleEnd: rand(15, 22) * scale,
        delay: rand(0, 0.18),
        life: rand(1.2, 2.0),
        opacity: 0.8,
        spin: rand(-0.5, 0.5),
        lit: fireLit,
        litHot: fireLitHot,
        shade: fireShade,
        shadeHot: fireShadeHot,
        glow: fireGlow,
      })
    }

    // Rolling cap: a wind-sheared torus of smoke that flattens and spreads.
    const capCount = Math.round(72 * density)
    for (let i = 0; i < capCount; i += 1) {
      const angle = Math.random() * TAU
      const radius = capRadius * rand(0.35, 1.0)
      const lift = Math.random() < 0.75 ? rand(0.92, 1.02) : rand(0.84, 0.92)
      emit({
        start: new THREE.Vector3(
          Math.cos(angle) * stemRadius * 0.4,
          height * rand(0.5, 0.68),
          Math.sin(angle) * stemRadius * 0.4,
        ),
        end: new THREE.Vector3(Math.cos(angle) * radius + windX * height, height * lift, Math.sin(angle) * radius + windZ * height),
        scaleStart: rand(10, 14) * scale,
        scaleEnd: rand(16, 24) * scale,
        delay: rand(0.18, 0.5),
        life: rand(3.5, 6),
        opacity: 0.46,
        spin: rand(-0.28, 0.28),
        lit: smokeLit,
        litHot: smokeLitHot,
        shade: smokeShade,
        shadeHot: smokeShadeHot,
        glow: noGlow,
      })
    }

    // Stem: drawn up from ground zero so the silhouette reads as a mushroom.
    const stemCount = Math.round(60 * density)
    for (let i = 0; i < stemCount; i += 1) {
      const angle = Math.random() * TAU
      const radius = stemRadius * rand(0.06, 0.3)
      const tower = Math.random()
      emit({
        start: new THREE.Vector3(Math.cos(angle) * 1.6 * scale, rand(0.5, 3) * scale, Math.sin(angle) * 1.6 * scale),
        end: new THREE.Vector3(
          Math.cos(angle) * radius + windX * height * 0.55,
          height * (0.42 + tower * 0.46),
          Math.sin(angle) * radius + windZ * height * 0.55,
        ),
        scaleStart: rand(7, 10) * scale,
        scaleEnd: rand(9, 14) * scale,
        delay: rand(0.04, 0.3),
        life: rand(3, 5.5),
        opacity: 0.44,
        spin: rand(-0.35, 0.35),
        lit: smokeLit,
        litHot: smokeLitHot,
        shade: smokeShade,
        shadeHot: smokeShadeHot,
        glow: noGlow,
      })
    }

    // Rolling dust skirt kicked out along the ground.
    const dustCount = Math.round(30 * density)
    for (let i = 0; i < dustCount; i += 1) {
      const angle = Math.random() * TAU
      const radius = dustRadius * rand(0.45, 0.95)
      emit({
        start: new THREE.Vector3(Math.cos(angle) * 2.5 * scale, 1.5 * scale, Math.sin(angle) * 2.5 * scale),
        end: new THREE.Vector3(Math.cos(angle) * radius, rand(0.5, 2.5) * scale, Math.sin(angle) * radius),
        scaleStart: rand(9, 13) * scale,
        scaleEnd: rand(13, 18) * scale,
        delay: rand(0, 0.16),
        life: rand(1.6, 2.8),
        opacity: 0.3,
        spin: rand(-0.4, 0.4),
        lit: dustLit,
        litHot: dustLitHot,
        shade: dustShade,
        shadeHot: dustShadeHot,
        glow: noGlow,
      })
    }

    // A few dark, low puffs to seat the column on the ground.
    const baseCount = Math.round(4 * density)
    for (let i = 0; i < baseCount; i += 1) {
      const angle = Math.random() * TAU
      emit({
        start: new THREE.Vector3(Math.cos(angle) * 4 * scale, 2 * scale, Math.sin(angle) * 4 * scale),
        end: new THREE.Vector3(Math.cos(angle) * 9 * scale, rand(2, 4) * scale, Math.sin(angle) * 9 * scale),
        scaleStart: rand(9, 12) * scale,
        scaleEnd: rand(12, 16) * scale,
        delay: 0,
        life: rand(2.5, 4),
        opacity: 0.26,
        spin: rand(-0.2, 0.2),
        lit: smokeShade,
        litHot: smokeShadeHot,
        shade: smokeShade,
        shadeHot: smokeShadeHot,
        glow: noGlow,
      })
    }

    const geometry = makeCloudGeometry(puffs)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uForm: { value: 2.6 },
        uNoise: { value: noiseTexture },
        uLightDirView: lightUniform,
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    group.add(mesh)

    // Blinding flash: a single additive billboard blown out into the bloom pass.
    const flashMaterial = new THREE.MeshBasicMaterial({
      map: noiseTexture,
      color: 0xfff2d8,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMaterial)
    flash.frustumCulled = false
    flash.renderOrder = 3
    group.add(flash)

    // Two additive rings rolling out across the surface.
    const ringSpecs = [
      { from: 2 * scale, to: 34 * scale, delay: 0, life: 0.45, opacity: 0.34, color: 0xffdcae },
      { from: 3.5 * scale, to: 52 * scale, delay: 0.07, life: 0.7, opacity: 0.1, color: 0xa9b6c6 },
    ]
    const rings = ringSpecs.map((spec) => {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72), ringMaterial)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.8 * scale
      ring.frustumCulled = false
      ring.renderOrder = 1
      group.add(ring)
      return { mesh: ring, material: ringMaterial, ...spec }
    })

    return { group, mesh, geometry, material, flash, flashMaterial, rings, elapsed: 0, duration, baseScale: scale }
  }

  function teardown(cloud: Cloud): void {
    cloud.flash.geometry.dispose()
    cloud.flashMaterial.dispose()
    for (const ring of cloud.rings) {
      ring.mesh.geometry.dispose()
      ring.material.dispose()
    }
    cloud.geometry.dispose()
    cloud.material.dispose()
    globe.remove(cloud.group)
  }

  function spawn(worldPosition: THREE.Vector3, spawnOptions?: ExplosionSpawnOptions): void {
    if (disposed || !visible) return

    if (clouds.length >= maxConcurrent) {
      const oldest = clouds.shift() as Cloud
      teardown(oldest)
    }

    scratchLocal.copy(worldPosition)
    globe.updateWorldMatrix(true, false)
    globe.worldToLocal(scratchLocal)
    scratchNormal.copy(scratchLocal).normalize()

    const scale = baseScale * (spawnOptions?.scale ?? 1)
    const cloud = buildCloud(scale)

    scratchQuat.setFromUnitVectors(UP, scratchNormal)
    cloud.group.quaternion.copy(scratchQuat)
    cloud.group.rotateY(Math.random() * TAU)
    // A slight lean so the column is never perfectly perpendicular — reads real.
    cloud.group.rotateX(THREE.MathUtils.degToRad(4 + Math.random() * 6))
    cloud.group.position.copy(scratchLocal)
    cloud.group.visible = visible
    globe.add(cloud.group)
    clouds.push(cloud)
  }

  function update(deltaSeconds: number): void {
    if (disposed) return
    const dt = Math.min(deltaSeconds, 0.1)

    if (camera) {
      camera.updateMatrixWorld()
      sunWorld.copy(getSunDirection ? getSunDirection() : UP)
      lightUniform.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse).normalize()
    }

    const cameraQuaternion = camera?.quaternion

    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i]
      cloud.elapsed += dt
      const t = cloud.elapsed / cloud.duration
      if (t >= 1) {
        teardown(cloud)
        clouds.splice(i, 1)
        continue
      }

      cloud.material.uniforms.uTime.value = cloud.elapsed

      if (cameraQuaternion) cloud.flash.quaternion.copy(cameraQuaternion)
      const flashLife = THREE.MathUtils.clamp(cloud.elapsed / 0.26, 0, 1)
      const flashEase = 1 - Math.pow(1 - flashLife, 3)
      cloud.flash.scale.setScalar(cloud.baseScale * (10 + 95 * flashEase))
      cloud.flashMaterial.opacity = Math.pow(1 - flashLife, 2)
      cloud.flash.visible = visible && flashLife < 1

      for (const ring of cloud.rings) {
        const life = THREE.MathUtils.clamp((cloud.elapsed - ring.delay) / ring.life, 0, 1)
        if (life <= 0) {
          ring.mesh.visible = false
          continue
        }
        ring.mesh.visible = visible
        const eased = 1 - Math.pow(1 - life, 3)
        ring.mesh.scale.setScalar(THREE.MathUtils.lerp(ring.from, ring.to, eased))
        ring.material.opacity = ring.opacity * (1 - life)
      }
    }
  }

  function setVisible(next: boolean): void {
    visible = next
    for (const cloud of clouds) {
      cloud.group.visible = next
      cloud.flash.visible = next
      for (const ring of cloud.rings) ring.mesh.visible = next
    }
  }

  function dispose(): void {
    disposed = true
    for (const cloud of clouds) teardown(cloud)
    clouds.length = 0
    noiseTexture.dispose()
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
