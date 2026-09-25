import * as THREE from 'three'
import { geoToVector3 } from './globeMaterial'
import { GLOBE_RADIUS } from './constants'
import type { Silo } from './globeData'

const UP = new THREE.Vector3(0, 1, 0)

export interface SiloLayerOptions {
  globe: THREE.Object3D
  silos: Silo[]
  color?: number
  ringColor?: number
}

export interface SiloLayer {
  setVisible: (visible: boolean) => void
  update: (deltaSeconds: number) => void
  readonly group: THREE.Group
  dispose: () => void
}

/**
 * Places launch-site markers on the globe surface: a pad, a glowing hatch and a
 * pulsing ground ring. The group is parented to the globe so it inherits the
 * globe's transform (tilt / intro animation) for free.
 */
export function createSiloLayer(options: SiloLayerOptions): SiloLayer {
  const globe = options.globe
  const silos = options.silos
  const color = options.color ?? 0x27313d
  const ringColor = options.ringColor ?? 0x7fe3ff

  const group = new THREE.Group()
  group.name = 'Silos'
  globe.add(group)

  const padGeometry = new THREE.CylinderGeometry(1.25, 1.6, 0.35, 20)
  const hatchGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.08, 20)
  const ringGeometry = new THREE.RingGeometry(1.9, 2.25, 40)

  const padMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.45 })
  const hatchMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d2a33,
    emissive: new THREE.Color(0x2fc6dd),
    emissiveIntensity: 1.6,
    metalness: 0.2,
    roughness: 0.35,
  })

  const rings: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; phase: number }> = []
  const disposables: Array<{ dispose: () => void }> = [padGeometry, hatchGeometry, ringGeometry, padMaterial, hatchMaterial]

  silos.forEach((silo, index) => {
    const marker = new THREE.Group()
    marker.name = `Silo_${silo.name}`

    const normal = geoToVector3(silo.lat, silo.lng).normalize()
    marker.position.copy(normal).multiplyScalar(GLOBE_RADIUS)
    marker.quaternion.setFromUnitVectors(UP, normal)

    const pad = new THREE.Mesh(padGeometry, padMaterial)
    pad.position.y = 0.17
    marker.add(pad)

    const hatch = new THREE.Mesh(hatchGeometry, hatchMaterial)
    hatch.position.y = 0.4
    marker.add(hatch)

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    marker.add(ring)

    disposables.push(ringMaterial)
    rings.push({ mesh: ring, material: ringMaterial, phase: index / silos.length })

    group.add(marker)
  })

  let elapsed = 0

  function update(deltaSeconds: number): void {
    elapsed += deltaSeconds
    for (const entry of rings) {
      const cycle = ((elapsed / 2.2 + entry.phase) % 1 + 1) % 1
      const eased = 1 - Math.pow(1 - cycle, 2)
      entry.mesh.scale.setScalar(0.6 + eased * 2.2)
      entry.material.opacity = 0.6 * (1 - cycle)
    }
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  function dispose(): void {
    globe.remove(group)
    for (const item of disposables) item.dispose()
  }

  return { setVisible, update, group, dispose }
}
