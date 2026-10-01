# 3D Globe

Interactive Earth visualization built with Three.js, three-globe, TypeScript, and Vite. Explore a textured globe with animated day/night lighting, city labels, and flight-route arcs.

**[Open the demo](https://itslucas02.github.io/3d-globe/)**

## Features

- Day and night Earth textures, moving sunlight, atmosphere, stars, and desktop bloom.
- City markers and labels, animated route arcs, and pulsing hub rings.
- Hover information and click-to-focus camera movement.
- A control panel for layers, auto-rotation, and simulated time speed.
- A reduced rendering profile for small screens and coarse-pointer devices.

City coordinates and routes are bundled demonstration data, not a live tracking feed.

### Feature branch

`feat/ballistic-missiles` additionally contains launch-site and target selection, single reentry vehicle and three-vehicle MIRV animations, trails, and mushroom-cloud effects. These features are not yet in `main` or the published demo. Launch markers and effects are illustrative graphics, not verified military locations or a physically accurate weapons simulation. Missile animations launch automatically by default on that branch.

## Run locally

Use Node.js 22.12 or newer on the Node 22 line (CI uses Node 22), npm, and a modern browser with WebGL support.

```sh
git clone https://github.com/itsLucas02/3d-globe.git
cd 3d-globe
npm ci
npm run dev
```

Open the local URL printed by Vite. No API keys, accounts, or backend services are required.

```sh
npm run build
npm run preview
```

The build runs TypeScript checks and writes the static site to `dist/`. Preview serves that build locally; it is not a production server. There is currently no automated test or lint script.

## Controls

| Control | Action |
| --- | --- |
| Drag | Orbit the globe |
| Scroll | Zoom |
| Hover | Show city, route, or coordinate information |
| Click a city | Focus the camera on it |
| `G` | Toggle graticules |
| `H` | Toggle the controls panel |
| Controls panel | Toggle layers, rotation, and sun speed |

The panel starts collapsed on screens narrower than 640 pixels. On `feat/ballistic-missiles`, the panel also offers launch site, target, and variant selection; selecting the same launch and target coordinates disables Launch.

## Project map

| File or directory | Responsibility |
| --- | --- |
| `src/main.ts` | Scene, renderer, camera, system wiring, animation loop, and responsive rendering profile |
| `src/globeMaterial.ts` | Day/night shader, solar position, and geographic coordinates |
| `src/globeData.ts` | Cities, hubs, and route arcs; demonstration launch sites on the feature branch |
| `src/interaction.ts`, `src/labels.ts`, `src/panel.ts` | Picking, focus movement, labels, and controls |
| `src/style.css` | Page, HUD, tooltip, and panel styling |
| `public/` | Earth textures and favicon |
| `.github/workflows/deploy.yml` | GitHub Pages build and deployment |

The missile feature branch also adds `src/missiles.ts`, `src/silos.ts`, `src/explosions.ts`, `public/models/`, and the Blender source asset `icbm.blend`.

In development, `window.__globe` exposes the scene and systems for inspection. Production enables it only when the URL contains `?debug`.

## Deployment

GitHub Actions builds and deploys pushes to `main`; the workflow can also be run manually. It installs the lockfile dependencies with `npm ci` and builds with `BASE_PATH=/3d-globe/` for the GitHub Pages project URL.

`vite.config.ts` reads `BASE_PATH`, defaulting to `/` for local use. When hosting under another subdirectory, set the matching base path at build time. Runtime asset URLs must continue to use `import.meta.env.BASE_URL` so textures and models load under that path.

## Contributing and agent guidance

Read [AGENTS.md](AGENTS.md) before changing the project. Keep changes focused, run `npm run build`, and check affected visual behavior in a browser. Report the reproduction steps, browser/device, expected result, and actual result when filing a bug.

## Licensing and assets

Original code and documentation are available under the [MIT License](LICENSE), copyright 2026 itsLucas02. Third-party dependencies and assets retain their own licenses; this code license does not grant rights to third-party assets.

Source and redistribution permissions for `public/img/earth-blue-marble.webp`, `public/img/earth-night.webp`, and the feature branch's bundled GLB models are not documented in the repository. Their filenames alone do not establish attribution or licensing; verify their provenance before redistributing them separately or claiming they share the code license.
