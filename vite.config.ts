import { defineConfig } from 'vite'

const VENDOR_GROUPS: Array<[string, string[]]> = [
  ['three', ['three']],
  [
    'globe',
    [
      'three-globe',
      'd3-array',
      'd3-color',
      'd3-geo',
      'd3-interpolate',
      'd3-scale',
      'd3-scale-chromatic',
      'h3-js',
      'three-conic-polygon-geometry',
      'three-geojson-geometry',
      'three-slippy-map-globe',
      '@tweenjs',
      'kapsule',
      'accessor-fn',
      'data-bind-mapper',
      'frame-ticker',
      'index-array-by',
      'tinycolor2',
    ],
  ],
]

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/, so the deploy build sets
  // BASE_PATH. Local dev and preview keep the root base.
  base: process.env.BASE_PATH || '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, '/')
          if (!normalized.includes('/node_modules/')) return undefined

          for (const [name, packages] of VENDOR_GROUPS) {
            if (packages.some((pkg) => normalized.includes(`/node_modules/${pkg}/`))) return name
          }

          return undefined
        },
      },
    },
  },
})
