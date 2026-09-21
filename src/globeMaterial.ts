import * as THREE from 'three'

const DEG2RAD = Math.PI / 180

export interface SubsolarPoint {
  lat: number
  lng: number
}

export function subsolarPoint(date: Date): SubsolarPoint {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0)
  const dayOfYear =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart) / 86400000

  const lat = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))

  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const lng = -15 * (utcHours - 12)

  return { lat, lng }
}

export function geoToVector3(lat: number, lng: number): THREE.Vector3 {
  const phi = (90 - lat) * DEG2RAD
  const theta = (90 - lng) * DEG2RAD

  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  )
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform vec3 sunDirection;
  uniform float dayGain;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(sunDirection);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    vec3 dayColor = texture2D(dayTexture, vUv).rgb;
    vec3 nightColor = texture2D(nightTexture, vUv).rgb;

    float sunAmount = dot(normal, sunDir);
    float dayness = smoothstep(-0.15, 0.25, sunAmount);

    vec3 dayLit = dayColor * vec3(1.05, 1.0, 0.94) * dayGain;
    vec3 nightLit = nightColor * vec3(1.0, 0.94, 0.78) * 1.6;

    vec3 color = mix(nightLit, dayLit, dayness);

    float twilight = exp(-pow(sunAmount / 0.16, 2.0));
    color += vec3(0.6, 0.26, 0.1) * twilight * 0.08;

    float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    color += vec3(0.16, 0.4, 0.85) * rim * 0.6;

    gl_FragColor = vec4(color, 1.0);
  }
`

export function createDayNightMaterial(
  dayTexture: THREE.Texture,
  nightTexture: THREE.Texture,
): THREE.ShaderMaterial {
  dayTexture.colorSpace = THREE.SRGBColorSpace
  nightTexture.colorSpace = THREE.SRGBColorSpace

  return new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      dayGain: { value: 1.35 },
    },
    vertexShader,
    fragmentShader,
  })
}
