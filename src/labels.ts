import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { GLOBE_RADIUS } from './constants'
import type { City } from './globeData'
import { geoToVector3 } from './globeMaterial'

export interface LabelLayer {
  render: () => void
  setSize: (width: number, height: number) => void
  setVisible: (visible: boolean) => void
}

const LABEL_ALTITUDE = 1.004
const LIMB_FADE = 0.06

export function createLabelLayer(
  container: HTMLElement,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  globe: THREE.Object3D,
  cities: City[],
): LabelLayer {
  const renderer = new CSS2DRenderer()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.domElement.className = 'label-layer'
  container.appendChild(renderer.domElement)

  const group = new THREE.Group()
  group.name = 'city-labels'
  globe.add(group)

  const objects = cities.map((city) => {
    const element = document.createElement('div')
    element.className = city.hub ? 'city-label city-label--hub' : 'city-label'
    element.textContent = city.name

    const object = new CSS2DObject(element)
    object.position.copy(geoToVector3(city.lat, city.lng)).multiplyScalar(GLOBE_RADIUS * LABEL_ALTITUDE)
    object.center.set(0, 0.5)
    group.add(object)

    return { object, element }
  })

  const worldPosition = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const toCamera = new THREE.Vector3()

  function render(): void {
    if (group.visible) {
      for (const { object, element } of objects) {
        object.getWorldPosition(worldPosition)
        normal.copy(worldPosition).normalize()
        toCamera.copy(camera.position).sub(worldPosition).normalize()

        const facing = normal.dot(toCamera)
        element.style.opacity = facing > LIMB_FADE ? '1' : '0'
      }
    }

    renderer.render(scene, camera)
  }

  function setSize(width: number, height: number): void {
    renderer.setSize(width, height)
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  return { render, setSize, setVisible }
}
