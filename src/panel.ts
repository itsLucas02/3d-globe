export type LayerId = 'routes' | 'cities' | 'rings' | 'graticules' | 'labels'

export interface PanelActions {
  setLayer: (layer: LayerId, visible: boolean) => void
  setAutoRotate: (enabled: boolean) => void
  setSunSpeed: (scale: number) => void
}

export interface PanelHandle {
  setLayerChecked: (layer: LayerId, checked: boolean) => void
  toggle: () => void
}

export interface PanelOptions {
  sunSpeed: number
  autoRotate: boolean
  layers: Record<LayerId, boolean>
}

const LAYERS: Array<{ id: LayerId; label: string }> = [
  { id: 'routes', label: 'Flight routes' },
  { id: 'cities', label: 'City markers' },
  { id: 'rings', label: 'Ping rings' },
  { id: 'graticules', label: 'Graticules' },
  { id: 'labels', label: 'City labels' },
]

export function createControlPanel(
  host: HTMLElement,
  actions: PanelActions,
  options: PanelOptions,
): PanelHandle {
  const layerRows = LAYERS.map(
    (layer) => `
      <label class="panel-row">
        <input type="checkbox" data-layer="${layer.id}" ${options.layers[layer.id] ? 'checked' : ''} />
        <span>${layer.label}</span>
      </label>`,
  ).join('')

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <button class="panel-toggle" type="button" aria-expanded="true" aria-controls="panel-body">
      <span class="panel-toggle-dot" aria-hidden="true"></span>
      <span>Controls</span>
    </button>
    <div class="panel-body" id="panel-body">
      <fieldset class="panel-group">
        <legend>Layers</legend>
        ${layerRows}
      </fieldset>
      <fieldset class="panel-group">
        <legend>Motion</legend>
        <label class="panel-row">
          <input type="checkbox" data-motion="rotate" ${options.autoRotate ? 'checked' : ''} />
          <span>Auto-rotate</span>
        </label>
      </fieldset>
      <fieldset class="panel-group">
        <legend>Sun</legend>
        <label class="panel-range">
          <span class="panel-range-head"><span>Time speed</span><output data-sun-output>${options.sunSpeed}&times;</output></span>
          <input type="range" min="0" max="2000" step="20" value="${options.sunSpeed}" data-sun-speed />
        </label>
      </fieldset>
    </div>
  `

  host.appendChild(panel)

  const toggleButton = panel.querySelector<HTMLButtonElement>('.panel-toggle')!
  const rangeInput = panel.querySelector<HTMLInputElement>('[data-sun-speed]')!
  const rangeOutput = panel.querySelector<HTMLOutputElement>('[data-sun-output]')!
  const rotateInput = panel.querySelector<HTMLInputElement>('[data-motion="rotate"]')!

  const layerInputs = new Map<LayerId, HTMLInputElement>()
  panel.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
    layerInputs.set(input.dataset.layer as LayerId, input)
  })

  function setCollapsed(collapsed: boolean): void {
    panel.classList.toggle('is-collapsed', collapsed)
    toggleButton.setAttribute('aria-expanded', String(!collapsed))
  }

  toggleButton.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('is-collapsed'))
  })

  layerInputs.forEach((input, layer) => {
    input.addEventListener('change', () => actions.setLayer(layer, input.checked))
  })

  rotateInput.addEventListener('change', () => actions.setAutoRotate(rotateInput.checked))

  rangeInput.addEventListener('input', () => {
    const value = Number(rangeInput.value)
    rangeOutput.textContent = `${value}\u00d7`
    actions.setSunSpeed(value)
  })

  setCollapsed(window.innerWidth < 640)

  return {
    setLayerChecked: (layer, checked) => {
      const input = layerInputs.get(layer)
      if (input) input.checked = checked
    },
    toggle: () => setCollapsed(!panel.classList.contains('is-collapsed')),
  }
}
