export type LayerId = 'routes' | 'cities' | 'rings' | 'missiles' | 'silos' | 'graticules' | 'labels'

export type MissileVariant = 'icbm' | 'mirv'

export interface StrikeRequest {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
  variant: MissileVariant
}

export interface SiteOption {
  name: string
  lat: number
  lng: number
  country?: string
}

export interface PanelActions {
  setLayer: (layer: LayerId, visible: boolean) => void
  setAutoRotate: (enabled: boolean) => void
  setSunSpeed: (scale: number) => void
  launch: (strike: StrikeRequest) => void
}

export interface PanelHandle {
  setLayerChecked: (layer: LayerId, checked: boolean) => void
  toggle: () => void
}

export interface PanelOptions {
  sunSpeed: number
  autoRotate: boolean
  layers: Record<LayerId, boolean>
  origins: SiteOption[]
  targets: SiteOption[]
}

const LAYERS: Array<{ id: LayerId; label: string }> = [
  { id: 'routes', label: 'Flight routes' },
  { id: 'cities', label: 'City markers' },
  { id: 'rings', label: 'Ping rings' },
  { id: 'missiles', label: 'Ballistic missiles' },
  { id: 'silos', label: 'Launch sites' },
  { id: 'graticules', label: 'Graticules' },
  { id: 'labels', label: 'City labels' },
]

function optionsFor(sites: SiteOption[]): string {
  return sites
    .map((site) => {
      const label = site.country ? `${site.name}, ${site.country}` : site.name
      return `<option value="${site.name}" data-lat="${site.lat}" data-lng="${site.lng}">${label}</option>`
    })
    .join('')
}

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
        <legend>Strike</legend>
        <label class="panel-select">
          <span>Launch site</span>
          <select data-strike="from">${optionsFor(options.origins)}</select>
        </label>
        <label class="panel-select">
          <span>Target</span>
          <select data-strike="to">${optionsFor(options.targets)}</select>
        </label>
        <label class="panel-select">
          <span>Warhead</span>
          <select data-strike="variant">
            <option value="icbm">Single RV</option>
            <option value="mirv">MIRV &middot; 3 RVs</option>
          </select>
        </label>
        <button class="panel-launch" type="button" data-strike-launch>Launch</button>
        <p class="panel-hint" data-strike-hint hidden>Pick a target different from the launch site</p>
      </fieldset>
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
  const fromSelect = panel.querySelector<HTMLSelectElement>('[data-strike="from"]')!
  const toSelect = panel.querySelector<HTMLSelectElement>('[data-strike="to"]')!
  const variantSelect = panel.querySelector<HTMLSelectElement>('[data-strike="variant"]')!
  const launchButton = panel.querySelector<HTMLButtonElement>('[data-strike-launch]')!
  const hint = panel.querySelector<HTMLParagraphElement>('[data-strike-hint]')!

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

  function readSite(select: HTMLSelectElement): { lat: number; lng: number } {
    const option = select.selectedOptions[0]
    return { lat: Number(option?.dataset.lat ?? 0), lng: Number(option?.dataset.lng ?? 0) }
  }

  /** A strike needs a target that is not the launch site itself. */
  function samePlace(): boolean {
    const from = readSite(fromSelect)
    const to = readSite(toSelect)
    return Math.abs(from.lat - to.lat) < 0.05 && Math.abs(from.lng - to.lng) < 0.05
  }

  function syncLaunchState(): void {
    const blocked = samePlace()
    launchButton.disabled = blocked
    hint.hidden = !blocked
  }

  fromSelect.addEventListener('change', syncLaunchState)
  toSelect.addEventListener('change', syncLaunchState)

  launchButton.addEventListener('click', () => {
    if (samePlace()) return
    const from = readSite(fromSelect)
    const to = readSite(toSelect)
    actions.launch({
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
      variant: variantSelect.value === 'mirv' ? 'mirv' : 'icbm',
    })
  })

  // Start on a distinct pair so the first click always works.
  if (samePlace() && toSelect.options.length > 1) {
    toSelect.selectedIndex = 1
  }
  syncLaunchState()

  setCollapsed(window.innerWidth < 640)

  return {
    setLayerChecked: (layer, checked) => {
      const input = layerInputs.get(layer)
      if (input) input.checked = checked
    },
    toggle: () => setCollapsed(!panel.classList.contains('is-collapsed')),
  }
}
