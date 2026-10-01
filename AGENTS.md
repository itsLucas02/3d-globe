# Agent instructions

## Project

Read [README.md](README.md) first. This is a browser-based Earth visualization using TypeScript, Three.js, three-globe, and Vite. It has no backend, authentication, or live tracking feed. Check the current branch: `feat/ballistic-missiles` has additional visual effects that are not yet in `main` or the published demo. Do not merge feature work as part of documentation or metadata maintenance.

## Working conventions

- Start from `src/main.ts` and trace the affected system before editing. Use configured codebase-memory-mcp tools for code discovery when available.
- Reuse existing modules, helpers, dependencies, and rendering profiles. Keep changes focused; do not introduce a framework or backend without a demonstrated need.
- Preserve `import.meta.env.BASE_URL` asset handling and the GitHub Pages `BASE_PATH` convention.
- Preserve the small-screen/coarse-pointer rendering profile. Dispose Three.js resources when their lifecycle ends, and avoid unnecessary allocations in the animation loop.
- Keep controls accessible and keep panel state synchronized with keyboard actions.
- Keep demonstration data and effects described accurately. Do not present launch markers as verified military sites or effects as physically accurate simulation.
- Preserve unrelated worktree changes. Do not commit credentials, local captures, or generated build output.
- Document source, attribution, and permissions when adding or replacing textures/models; do not assume the code license covers third-party assets.

## Verification and delivery

- Run `npm run build` for code/configuration changes; this includes TypeScript checks. There are no test or lint scripts currently.
- For visual or interaction changes, verify the affected flow in a real browser at desktop and narrow widths, including loading, console errors, controls, and relevant animations. A successful build alone does not prove rendering works.
- Keep README instructions aligned with the scripts and deployment workflow. Pushing to `main` triggers the existing Pages deployment; publish only within the user's requested scope.
- Report what changed, what was verified, and any remaining limitations.
