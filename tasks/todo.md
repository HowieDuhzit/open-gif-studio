# GIF Editor Plan

## Goal

Build a web app GIF editor that feels like a classic video editor: media bin, preview monitor, timeline, inspector, and export flow. The editor should support non-destructive edits for color changes, transforms, playback controls, filters, effects, and final GIF export.

## Research Summary

- Browser-only editing is best for responsive preview and privacy, but raw decoded GIF frames can exhaust memory quickly.
- `ffmpeg.wasm` is useful for optional client-side media conversion, but it is too heavy and fragile to be the only serious rendering path.
- A production-quality editor should use a hybrid model: browser timeline and previews, server-side native rendering for final exports.
- GIF-specific correctness matters: frame delays, disposal modes, palettes, transparency, dithering, loop count, and optimization all affect output quality.
- The UX should prioritize timeline confidence and reversible edits over exposing every effect at once.

## Recommended Stack

### MVP Stack

- Vite + React + TypeScript for the web app.
- Canvas or OffscreenCanvas for preview rendering.
- Web Workers for decode/render/export work that would otherwise block the UI.
- `gifuct-js` for GIF decoding.
- `gif.js` or `omggif` for browser-side GIF export.
- Zustand or a small reducer/store for editor state and undo/redo.
- CSS modules or plain CSS variables initially; avoid a heavy component system until the UI language is clear.

### Production Stack

- Keep the React timeline editor in-browser.
- Add a render API with Node, queue-backed jobs, and object storage for uploads/outputs.
- Use native FFmpeg for media import/export and timeline rendering.
- Use ImageMagick for advanced image effects where FFmpeg filters are awkward.
- Use Gifsicle after render for GIF optimization and loop/frame operations.
- Use Sharp for thumbnails, still previews, and fast image normalization.

## Product Shape

### Classic Editor Layout

- Top toolbar: import, undo, redo, save project, export.
- Left panel: media bin, source metadata, recent assets.
- Center: preview monitor with play, pause, frame step, before/after, zoom-to-fit, actual-size preview.
- Right panel: inspector for clip, timeline, color, transform, filter, and export settings.
- Bottom: timeline with thumbnails, playhead, trim handles, frame ticks, loop region, duration markers.

### Editing Model

- Keep the source file immutable.
- Store edits as an ordered operation stack.
- Render previews from source frames plus operations.
- Bake edits only during export.
- Maintain undo/redo from operation history.
- Store project state locally so accidental refreshes are recoverable.

## Feature Plan

### Phase 1: Foundation

- [x] Scaffold Vite + React + TypeScript app.
- [x] Build app shell with editor layout: media bin, preview, inspector, timeline.
- [x] Add upload/import for GIF files.
- [x] Decode GIF frames and metadata.
- [x] Render current frame to canvas preview.
- [x] Add play, pause, scrub, frame step, and timeline thumbnails.

### Phase 2: Timeline Basics

- [x] Add trim in/out controls.
- [x] Add reverse playback.
- [x] Add speed/frame delay controls.
- [x] Add loop count setting.
- [ ] Add duplicate/delete frame or selected range.
- [x] Add undo/redo for timeline operations.

### Phase 3: Transform Tools

- [x] Add horizontal and vertical flip.
- [x] Add rotate by free angle.
- [x] Add crop and resize.
- [ ] Add rounded corners and canvas/background color.
- [ ] Add border/frame controls.

### Phase 4: Color Tools

- [x] Add grayscale, sepia, monochrome, and negative presets.
- [x] Add brightness and contrast sliders.
- [x] Add hue, saturation, and lightness sliders.
- [x] Add tint color picker with intensity.
- [ ] Add before/after preview toggle.

### Phase 5: Filters And Effects

- [x] Add blur.
- [x] Add vignette and noise.
- [x] Add reorderable effect stack.
- [x] Add browser-side background removal as color-key removal with tolerance and softness.
- [x] Add targeted color replacement effect with source color, replacement color, tolerance, and softness.
- [ ] Add posterize and solarize.
- [ ] Add emboss and oil-paint-style effect if performance allows.
- [ ] Add wave, swirl, and implode distortions as advanced effects.
- [ ] Add Instagram-like presets: Gotham, Lomo, Toaster, Vignette, Polaroid, Nashville.

### Phase 6: Export

- [ ] Add export modal with dimensions, FPS, duration, palette/quality, loop count, and estimated file size.
- [x] Export edited GIF in-browser for MVP.
- [x] Show render progress.
- [ ] Preview final output before download.
- [ ] Add output optimization pass if library support allows.

### Phase 7: Server Render Path

- [ ] Add API for uploading source media and project JSON.
- [ ] Add render job queue.
- [ ] Implement FFmpeg/ImageMagick/Gifsicle render pipeline.
- [ ] Add job progress, retries, cancellation, and cleanup.
- [ ] Add final export download links.

## MVP Cut

Build first:

- Import GIF.
- Preview/play/scrub timeline.
- Trim, reverse, speed/frame delay, loop count.
- Flip, rotate, crop, resize.
- Grayscale, sepia, invert, brightness, contrast, saturation.
- Export GIF in-browser.
- Undo/redo and local autosave.

Defer:

- Multi-track editing.
- Audio.
- Keyframes.
- Account system/cloud projects.
- Collaboration.
- AI effects.
- Full video import/export.
- Server render path until MVP proves useful.

## Design Direction

Use a classic video editor visual language without copying a specific product:

- Dark graphite workspace with high-contrast timeline accents.
- Dense professional controls, but progressive disclosure in the inspector.
- Timeline thumbnails as the hero interaction.
- Large preview monitor with exact output framing.
- Clear output status: dimensions, duration, frame count, FPS, estimated size.
- Avoid generic SaaS cards; make it feel like a real editing surface.

## Key Risks

- Large GIFs can exceed browser memory after decoding.
- Browser GIF export may produce larger or lower-quality files than native tools.
- Preview and export may differ due to palette, dithering, and disposal behavior.
- Classic editor UI can overwhelm casual users if all tools are visible at once.
- Mobile timeline controls need a simplified mode.
- Advanced distortions and artistic filters can be slow without workers or GPU acceleration.

## Verification Plan

- Validate import and playback with GIFs using different frame delays and disposal methods.
- Compare exported duration, frame count, loop count, and dimensions against source/edit settings.
- Test memory behavior with small, medium, and large GIFs.
- Verify each operation is non-destructive and undoable.
- Run browser tests for timeline controls and export flow.
- Manually test responsive layout on desktop and mobile widths.

## Approval Checkpoint

- [ ] Confirm stack choice.
- [ ] Confirm MVP scope.
- [ ] Confirm whether to start browser-only or include server rendering immediately.
- [ ] Confirm preferred package manager and deployment target.

## Review

Browser-only MVP implementation started and verified with `npm run build`.

Implemented:

- Vite + React + TypeScript app scaffold.
- Classic editor layout with media bin, monitor, inspector, transport, and timeline strip.
- GIF import and decoding with `gifuct-js`.
- Canvas preview, playback, frame stepping, scrubber, and thumbnails.
- Trim, reverse, speed, loop count, flip, rotate, crop, resize, color presets, brightness, contrast, saturation, hue, and tint controls.
- Undo/redo for edit settings and local edit autosave.
- In-browser GIF export with `gif.js`, progress, final download link, and loop count support.
- Reorderable effect stack with add, remove, enable/disable, move up, and move down controls.
- Drag-and-drop reordering for effect cards, with Up/Down controls retained as fallbacks.
- Color-key background removal effect for solid/near-solid backgrounds.
- Targeted color replacement effect for swapping one picked color range to another.
- Preview color sampling buttons for tint, color replacement, and background removal color selectors. The sampled preview pixel updates the matching color input.
- Custom color popover controls now put the eyedropper icon inside the color popup UI.
- Effect drag reordering is restricted to the handle, preventing sliders and controls from starting reorder drags.
- App-level GIF drag/drop ignores internal effect drag events.
- App shell is fixed to the viewport with document scrolling disabled; panels, inspector, toolbar, transport, and timeline now scroll internally where needed.
- Responsive breakpoints keep the monitor, inspector, and timeline contained on desktop, tablet, mobile, and short-height screens.
- Preview monitor now autofits the GIF and includes zoom out, zoom in, zoom percent, Fit, and drag-to-pan when zoomed.
- Viewer now supports scroll-wheel zoom, panning at all zoom levels, and Fit resets zoom/pan to the autofit view.
- Fit now uses a computed monitor-to-output scale, so oversized GIFs shrink to fit the viewer panel instead of resetting to raw 100% canvas size.
- Viewer centering now uses computed canvas display dimensions instead of transform scaling, so fit-to-panel centers vertically and horizontally correctly.
- Timeline thumbnails now render from the current edit state instead of static source thumbnails.
- Effect stacks can now target either the whole GIF or the selected frame; preview, thumbnails, and export combine global effects with per-frame effects.
- Media bin, viewer, and timeline panels are collapsible; the right-side panel remains dedicated to effects.
- Timing and Transform are now first-class effect cards in the global effect stack.
- The former inspector is now an Effects panel centered on the full stack workflow.
- Effect stack presets can be saved to and loaded from local storage.
- Export now opens a dedicated modal with file name, quality, worker count, dithering, transparency optimization, render progress, and the final download action.
- The old inline transport download button has been removed; download now happens from the export flow.
- Export modal now includes a live render preview of the current frame.
- Rebranded to Open GIF Studio (OGS), with GitHub and Buy Me a Coffee links in the top bar.
- Project was initialized as git, committed, and published to a new GitHub repository.
- Media bin now supports multiple GIFs in a single project, with additive import and multi-file drag/drop.
- Projects can now be saved to and loaded from `.ogsp.json` files containing source GIFs and edit state.

Verified:

- `npm run build` passes.
- Fixed GIF frame reconstruction to alpha-composite transparent patches instead of erasing previous frame content.
- Added drag-and-drop GIF loading and clickable empty-state import.
- Improved transparency handling for background removal with checkerboard preview and transparent GIF export keying.

Known gaps:

- No duplicate/delete frame operation yet.
- No export cancellation yet.
- No before/after preview toggle yet.
- Sharpen and advanced filters/effects are not implemented yet.
- Background removal is color-key based, not AI person/object segmentation.
