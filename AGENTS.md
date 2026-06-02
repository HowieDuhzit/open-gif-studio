# AGENTS.md

## Commands

- Use npm, not pnpm/yarn; `package-lock.json` is committed and Docker uses `npm ci`.
- Install with `npm ci`.
- Dev server: `npm run dev`.
- Production build/typecheck: `npm run build` (`tsc -b` runs before `vite build`).
- Preview built Vite app: `npm run preview`.
- Production server: run `npm run build` first, then `npm start`; `server.mjs` serves `dist` on `PORT` default `3000`.
- Focused server syntax check: `node --check server.mjs`.
- There are no repo test, lint, or formatter scripts in `package.json`; use `npm run build` as the main verification step unless you add scripts.

## App Wiring

- This is a single-package Vite + React + TypeScript app; `src/main.tsx` mounts `src/App.tsx`.
- Most editor state, rendering, import, export, localStorage, Magnific, GIPHY, and bulk export UI logic lives in `src/App.tsx`; avoid assuming separate feature modules exist.
- GIF decoding imports `src/gifDecodeWorker.js?worker&url` so Vite emits a production worker asset; GIF export uses `gif.js` and `gif.js/dist/gif.worker.js` via `new URL(..., import.meta.url)`.
- Do not rename the decode worker back to `.ts` without retesting browser worker loading; the latest history fixed a CSP/worker issue by using `src/gifDecodeWorker.js`.
- Browser storage keys are legacy-named: `frameforge-editor-state`, `frameforge-effect-presets`, and `ogs-theme-mode`.
- Projects save/load as `.ogsp.json` files that include source image data URLs and editor state.

## Import And Export

- Supported imports are GIF, APNG/PNG, WebP, AVIF, and JPEG. Animated non-GIF decoding depends on browser `ImageDecoder`; static fallback uses `createImageBitmap`.
- Import guardrails in `src/App.tsx`: max file size 25 MB, max 512 frames, max dimension 4096, and max 16,000,000 pixels.
- Multi-file import decodes with bounded concurrency based on `navigator.hardwareConcurrency`; keep progress updates and UI responsiveness in mind when touching import code.
- Export is still browser-side: single GIF export uses `gif.js`; `Export All` creates a ZIP with JSZip and skips assets hidden from bulk export.

## API And Env

- Required env names are in `.env.example`: `MAGNIFIC_API_KEY`, `GIPHY_API_KEY`, `PORT`.
- Keep API keys server-side. Client code calls same-origin `/api/...` routes; do not add public `VITE_` API keys.
- Vite dev/preview proxies for `/api/magnific/*` and `/api/giphy/upload` live in `vite.config.ts`; production equivalents live in `server.mjs`.
- `server.mjs` also handles `/healthz` and static SPA fallback from `dist`.
- If adding external browser connections or workers, update CSP in both `index.html` and runtime headers in `vite.config.ts` / `server.mjs` as applicable.
- Keep `frame-ancestors` out of the `index.html` meta CSP; it belongs in server headers only.

## Deployment

- Docker builds with Node 22 Alpine, runs `npm ci`, then `npm run build`, and executes `node server.mjs` as the non-root `node` user.
- `docker-compose.yml` exposes port `3000` internally, passes `MAGNIFIC_API_KEY` and `GIPHY_API_KEY`, and health-checks `/healthz`.

## Current Scope Notes

- The implemented MVP is browser-side editing/export; the native FFmpeg/ImageMagick/Gifsicle server render path is intentionally deferred in `tasks/todo.md`.
- Known product gap from `tasks/todo.md`: background removal is color-key based, not AI segmentation.
