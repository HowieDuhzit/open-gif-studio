import { ChangeEvent, DragEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import GIF from "gif.js";
import { decompressFrames, parseGIF } from "gifuct-js";

type SourceFrame = {
  index: number;
  imageData: ImageData;
  delay: number;
  thumbnail: string;
};

type Preset = "grayscale" | "sepia" | "monochrome" | "invert";

type EffectKind = "timing" | "transform" | "preset" | "adjust" | "tint" | "color-replace" | "blur" | "vignette" | "noise" | "background-removal";

type BaseEffect = {
  id: string;
  kind: EffectKind;
  enabled: boolean;
};

type TimingEffect = BaseEffect & { kind: "timing"; trimStart: number; trimEnd: number; reverse: boolean; speed: number; loopCount: number };
type TransformEffect = BaseEffect & {
  kind: "transform";
  flipH: boolean;
  flipV: boolean;
  rotate: number;
  scale: number;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
};
type PresetEffect = BaseEffect & { kind: "preset"; preset: Preset };
type AdjustEffect = BaseEffect & { kind: "adjust"; brightness: number; contrast: number; saturation: number; lightness: number; hue: number };
type TintEffect = BaseEffect & { kind: "tint"; color: string; amount: number };
type ColorReplaceEffect = BaseEffect & { kind: "color-replace"; from: string; to: string; tolerance: number; softness: number };
type BlurEffect = BaseEffect & { kind: "blur"; radius: number };
type VignetteEffect = BaseEffect & { kind: "vignette"; amount: number };
type NoiseEffect = BaseEffect & { kind: "noise"; amount: number };
type BackgroundRemovalEffect = BaseEffect & { kind: "background-removal"; color: string; tolerance: number; softness: number };

type Effect = TimingEffect | TransformEffect | PresetEffect | AdjustEffect | TintEffect | ColorReplaceEffect | BlurEffect | VignetteEffect | NoiseEffect | BackgroundRemovalEffect;
type ColorPickTarget = { effectId: string; field: "color" | "from" | "to" };
type PanPoint = { x: number; y: number };
type EffectScope = "project" | "global" | "frame";

type EditorState = {
  effects: Effect[];
  frameEffects: Record<string, Effect[]>;
};

type ProjectAsset = {
  id: string;
  name: string;
  width: number;
  height: number;
  frames: SourceFrame[];
  sourceDataUrl: string;
};

type WorkspaceProject = {
  name: string;
  activeAssetId: string;
  assets: ProjectAsset[];
  projectEffects: Effect[];
  editors: Record<string, EditorState>;
};

type SavedProject = {
  name: string;
  activeAssetId: string;
  assets: Array<{
    id: string;
    name: string;
    sourceDataUrl: string;
  }>;
  projectEffects: Effect[];
  editors: Record<string, EditorState>;
};

type ExportSettings = {
  fileName: string;
  quality: number;
  workers: number;
  dither: boolean;
  optimizeTransparency: boolean;
};

type MagnificIconOrder = "recent" | "relevance";
type MagnificIconStyleFilter = "all" | "basic-accent-lineal-color" | "basic-accent-outline";
type ThemeMode = "dark" | "light";

type MagnificIcon = {
  id: number;
  name: string;
  slug: string;
  free_svg: boolean;
  thumbnails: Array<{ url: string; width: number; height: number }>;
  style: { id: number; name: string };
  author: { id: number; name: string; slug: string };
};

type MagnificPagination = {
  current_page: number;
  per_page: number;
  last_page: number;
  total: number;
};

type MagnificIconsResponse = {
  data: MagnificIcon[];
  meta: { pagination: MagnificPagination };
};

const repoUrl = "https://github.com/HowieDuhzit/open-gif-studio";
const donationUrl = "https://buymeacoffee.com/howieduhzit";

const initialEditor: EditorState = {
  effects: [],
  frameEffects: {},
};

const workerScript = new URL("gif.js/dist/gif.worker.js", import.meta.url).href;
const autosaveKey = "frameforge-editor-state";
const presetStorageKey = "frameforge-effect-presets";
const themeStorageKey = "ogs-theme-mode";
const transparencyKey = { r: 255, g: 0, b: 255 };
const transparencyKeyNumber = 0xff00ff;
const initialMagnificPagination: MagnificPagination = { current_page: 1, per_page: 24, last_page: 1, total: 0 };
const magnificStyleNames: Record<MagnificIconStyleFilter, string | null> = {
  all: null,
  "basic-accent-lineal-color": "Basic Accent Lineal Color",
  "basic-accent-outline": "Basic Accent Outline",
};
const defaultExportSettings: ExportSettings = {
  fileName: "edited-animation",
  quality: 10,
  workers: 2,
  dither: false,
  optimizeTransparency: true,
};

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    if (max === gn) h = (bn - rn) / d + 2;
    if (max === bn) h = (rn - gn) / d + 4;
    h /= 6;
  }

  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number) {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function ColorField({
  label,
  value,
  onChange,
  onPickPreview,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  onPickPreview: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <label>
      {label}
      <span className="color-popover-wrap">
        <button className="color-trigger" type="button" onClick={() => setOpen((next) => !next)}>
          <span className="color-swatch" style={{ background: value }} />
          <span>{value}</span>
        </button>
        {open && (
          <span className="color-popover">
            <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
            <button
              className="eyedropper-button"
              type="button"
              aria-label={`Pick ${label.toLowerCase()} from preview`}
              title="Pick from preview"
              onClick={() => {
                onPickPreview();
                setOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.7 4.3a2.5 2.5 0 0 1 3.5 0l1.5 1.5a2.5 2.5 0 0 1 0 3.5l-2 2 1 1-1.4 1.4-1-1-7.1 7.1H4.2v-5l7.1-7.1-1-1 1.4-1.4 1 1 2-2Zm-8.5 11.3v2.2h2.2l6.5-6.5-2.2-2.2-6.5 6.5Z" />
              </svg>
            </button>
          </span>
        )}
      </span>
    </label>
  );
}

function getTimingEffect(effects: Effect[]) {
  return effects.find((effect): effect is TimingEffect => effect.kind === "timing") ?? { id: "timing-default", kind: "timing", enabled: true, trimStart: 0, trimEnd: 0, reverse: false, speed: 1, loopCount: 0 };
}

function getTransformEffect(effects: Effect[]) {
  return effects.find((effect): effect is TransformEffect => effect.kind === "transform") ?? { id: "transform-default", kind: "transform", enabled: true, flipH: false, flipV: false, rotate: 0, scale: 1, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 };
}

function cloneEffects<T extends Effect>(effects: T[]) {
  return effects.map((effect) => ({ ...effect }));
}

function createDefaultEditor() {
  return {
    effects: cloneEffects(initialEditor.effects),
    frameEffects: {},
  } satisfies EditorState;
}

function createEffect(kind: EffectKind): Effect {
  const id = `${kind}-${crypto.randomUUID()}`;
  if (kind === "timing") return { id, kind, enabled: true, trimStart: 0, trimEnd: 0, reverse: false, speed: 1, loopCount: 0 };
  if (kind === "transform") return { id, kind, enabled: true, flipH: false, flipV: false, rotate: 0, scale: 1, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 };
  if (kind === "preset") return { id, kind, enabled: true, preset: "grayscale" };
  if (kind === "adjust") return { id, kind, enabled: true, brightness: 0, contrast: 0, saturation: 0, lightness: 0, hue: 0 };
  if (kind === "tint") return { id, kind, enabled: true, color: "#f4b860", amount: 35 };
  if (kind === "color-replace") return { id, kind, enabled: true, from: "#00ff00", to: "#f4b860", tolerance: 22, softness: 20 };
  if (kind === "blur") return { id, kind, enabled: true, radius: 2 };
  if (kind === "vignette") return { id, kind, enabled: true, amount: 45 };
  if (kind === "noise") return { id, kind, enabled: true, amount: 12 };
  return { id, kind, enabled: true, color: "#00ff00", tolerance: 22, softness: 10 };
}

function effectName(effect: Effect) {
  if (effect.kind === "background-removal") return "Background removal";
  return effect.kind.replace("-", " ");
}

function applyPresetToPixel(r: number, g: number, b: number, preset: Preset) {
  if (preset === "grayscale") {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    return [gray, gray, gray];
  }

  if (preset === "sepia") {
    return [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b];
  }

  if (preset === "monochrome") {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const value = gray > 128 ? 255 : 0;
    return [value, value, value];
  }

  return [255 - r, 255 - g, 255 - b];
}

function applyPixelEffect(imageData: ImageData, effect: Effect) {
  const next = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = next.data;
  const tint = effect.kind === "tint" ? hexToRgb(effect.color) : { r: 0, g: 0, b: 0 };
  const key = effect.kind === "background-removal" ? hexToRgb(effect.color) : { r: 0, g: 0, b: 0 };
  const replaceFrom = effect.kind === "color-replace" ? hexToRgb(effect.from) : { r: 0, g: 0, b: 0 };
  const replaceTo = effect.kind === "color-replace" ? hexToRgb(effect.to) : { r: 0, g: 0, b: 0 };
  const contrastFactor = effect.kind === "adjust" ? (259 * (effect.contrast + 255)) / (255 * (259 - effect.contrast)) : 1;
  const saturation = effect.kind === "adjust" ? effect.saturation / 100 : 0;
  const centerX = imageData.width / 2;
  const centerY = imageData.height / 2;
  const maxDistance = Math.hypot(centerX, centerY);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    let a = data[i + 3];

    if (effect.kind === "preset") {
      [r, g, b] = applyPresetToPixel(r, g, b, effect.preset);
    }

    if (effect.kind === "adjust") {
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luminance + (r - luminance) * (1 + saturation);
      g = luminance + (g - luminance) * (1 + saturation);
      b = luminance + (b - luminance) * (1 + saturation);

      if (effect.hue !== 0) {
        const [h, s, l] = rgbToHsl(r, g, b);
        const [hr, hg, hb] = hslToRgb((h + effect.hue / 360 + 1) % 1, s, l);
        r = hr;
        g = hg;
        b = hb;
      }

      if (effect.lightness !== 0) {
        const [h, s, l] = rgbToHsl(r, g, b);
        const [lr, lg, lb] = hslToRgb(h, s, Math.max(0, Math.min(1, l + effect.lightness / 100)));
        r = lr;
        g = lg;
        b = lb;
      }

      r = contrastFactor * (r - 128) + 128 + effect.brightness;
      g = contrastFactor * (g - 128) + 128 + effect.brightness;
      b = contrastFactor * (b - 128) + 128 + effect.brightness;
    }

    if (effect.kind === "tint" && effect.amount > 0) {
      const tintMix = effect.amount / 100;
      r = r * (1 - tintMix) + tint.r * tintMix;
      g = g * (1 - tintMix) + tint.g * tintMix;
      b = b * (1 - tintMix) + tint.b * tintMix;
    }

    if (effect.kind === "vignette" && effect.amount > 0) {
      const pixel = i / 4;
      const x = pixel % imageData.width;
      const y = Math.floor(pixel / imageData.width);
      const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
      const shade = 1 - Math.max(0, distance - 0.25) * (effect.amount / 65);
      r *= shade;
      g *= shade;
      b *= shade;
    }

    if (effect.kind === "noise" && effect.amount > 0) {
      const grain = (Math.random() - 0.5) * effect.amount * 2;
      r += grain;
      g += grain;
      b += grain;
    }

    if (effect.kind === "background-removal") {
      const distance = Math.hypot(r - key.r, g - key.g, b - key.b);
      const tolerance = effect.tolerance * 4.42;
      const softness = Math.max(1, effect.softness * 4.42);
      if (distance <= tolerance) a = 0;
      if (distance > tolerance && distance < tolerance + softness) a *= (distance - tolerance) / softness;
    }

    if (effect.kind === "color-replace") {
      const distance = Math.hypot(r - replaceFrom.r, g - replaceFrom.g, b - replaceFrom.b);
      const tolerance = effect.tolerance * 4.42;
      const softness = Math.max(1, effect.softness * 4.42);
      let mix = 0;
      if (distance <= tolerance) mix = 1;
      if (distance > tolerance && distance < tolerance + softness) mix = 1 - (distance - tolerance) / softness;
      r = r * (1 - mix) + replaceTo.r * mix;
      g = g * (1 - mix) + replaceTo.g * mix;
      b = b * (1 - mix) + replaceTo.b * mix;
    }

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
    data[i + 3] = clamp(a);
  }

  return next;
}

function applyEffectStack(imageData: ImageData, effects: Effect[]) {
  const canvas = document.createElement("canvas");
  const scratch = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  scratch.width = imageData.width;
  scratch.height = imageData.height;
  const ctx = canvas.getContext("2d");
  const scratchCtx = scratch.getContext("2d");
  if (!ctx || !scratchCtx) return imageData;
  ctx.putImageData(imageData, 0, 0);

  effects.filter((effect) => effect.enabled).forEach((effect) => {
    if (effect.kind === "blur") {
      scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
      scratchCtx.filter = `blur(${effect.radius}px)`;
      scratchCtx.drawImage(canvas, 0, 0);
      scratchCtx.filter = "none";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(scratch, 0, 0);
      return;
    }

    ctx.putImageData(applyPixelEffect(ctx.getImageData(0, 0, canvas.width, canvas.height), effect), 0, 0);
  });

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function prepareGifTransparency(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      data[i] = transparencyKey.r;
      data[i + 1] = transparencyKey.g;
      data[i + 2] = transparencyKey.b;
      data[i + 3] = 255;
    } else {
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function getOutputSize(project: ProjectAsset, editor: EditorState) {
  const transform = getTransformEffect(editor.effects);
  const sourceWidth = project.width * (transform.cropWidth / 100);
  const sourceHeight = project.height * (transform.cropHeight / 100);
  const radians = (Math.abs(transform.rotate) * Math.PI) / 180;
  const rotatedWidth = Math.abs(Math.cos(radians)) * sourceWidth + Math.abs(Math.sin(radians)) * sourceHeight;
  const rotatedHeight = Math.abs(Math.sin(radians)) * sourceWidth + Math.abs(Math.cos(radians)) * sourceHeight;
  const width = Math.max(1, Math.round(rotatedWidth * transform.scale));
  const height = Math.max(1, Math.round(rotatedHeight * transform.scale));
  return { width, height };
}

function renderFrame(target: HTMLCanvasElement, frame: SourceFrame, project: ProjectAsset, editor: EditorState, projectEffects: Effect[] = []) {
  const transform = getTransformEffect(editor.effects);
  const source = document.createElement("canvas");
  source.width = project.width;
  source.height = project.height;
  const effects = [...projectEffects, ...editor.effects, ...(editor.frameEffects[String(frame.index)] ?? [])];
  source.getContext("2d")?.putImageData(applyEffectStack(frame.imageData, effects.filter((effect) => effect.kind !== "timing" && effect.kind !== "transform")), 0, 0);

  const { width, height } = getOutputSize(project, editor);
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((transform.rotate * Math.PI) / 180);
  ctx.scale(transform.flipH ? -transform.scale : transform.scale, transform.flipV ? -transform.scale : transform.scale);
  const sx = project.width * (transform.cropLeft / 100);
  const sy = project.height * (transform.cropTop / 100);
  const sw = project.width * (transform.cropWidth / 100);
  const sh = project.height * (transform.cropHeight / 100);
  ctx.drawImage(source, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

function renderFrameThumbnail(frame: SourceFrame, project: ProjectAsset, editor: EditorState, projectEffects: Effect[] = []) {
  const rendered = document.createElement("canvas");
  renderFrame(rendered, frame, project, editor, projectEffects);

  const thumb = document.createElement("canvas");
  thumb.width = 96;
  thumb.height = 72;
  const ctx = thumb.getContext("2d");
  if (!ctx) return frame.thumbnail;

  const scale = Math.min(thumb.width / rendered.width, thumb.height / rendered.height);
  const width = rendered.width * scale;
  const height = rendered.height * scale;
  ctx.drawImage(rendered, (thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
  return thumb.toDataURL("image/png");
}

function getOpaqueBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function renderAssetThumbnail(frame: SourceFrame, project: ProjectAsset, editor: EditorState, projectEffects: Effect[] = []) {
  const rendered = document.createElement("canvas");
  renderFrame(rendered, frame, project, editor, projectEffects);

  const thumb = document.createElement("canvas");
  thumb.width = 52;
  thumb.height = 52;
  const ctx = thumb.getContext("2d");
  if (!ctx) return frame.thumbnail;

  const bounds = getOpaqueBounds(rendered);
  if (!bounds) return thumb.toDataURL("image/png");

  const padding = 2;
  const scale = Math.min((thumb.width - padding * 2) / bounds.width, (thumb.height - padding * 2) / bounds.height);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  ctx.drawImage(
    rendered,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    (thumb.width - width) / 2,
    (thumb.height - height) / 2,
    width,
    height,
  );

  return thumb.toDataURL("image/png");
}

function getPlayableFrames(project: ProjectAsset | null, editor: EditorState) {
  if (!project) return [];
  const timing = getTimingEffect(editor.effects);
  const end = timing.trimEnd || project.frames.length - 1;
  const start = Math.min(timing.trimStart, end);
  const safeEnd = Math.max(timing.trimStart, end);
  const trimmed = project.frames.slice(start, safeEnd + 1);
  return timing.reverse ? [...trimmed].reverse() : trimmed;
}

function rangeLabel(project: ProjectAsset | null, editor: EditorState) {
  if (!project) return "0 frames";
  const frames = getPlayableFrames(project, editor);
  const timing = getTimingEffect(editor.effects);
  const duration = frames.reduce((sum, frame) => sum + frame.delay / timing.speed, 0);
  return `${frames.length} frames · ${(duration / 1000).toFixed(2)}s`;
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function dataUrlToArrayBuffer(dataUrl: string) {
  const response = await fetch(dataUrl);
  return await response.arrayBuffer();
}

async function decodeGifAsset(name: string, buffer: ArrayBuffer, sourceDataUrl: string): Promise<ProjectAsset> {
  const parsed = parseGIF(buffer);
  const decoded = decompressFrames(parsed, true) as Array<{
    dims: { left: number; top: number; width: number; height: number };
    patch: Uint8ClampedArray;
    delay: number;
    disposalType: number;
  }>;
  const gifMeta = parsed as unknown as { lsd: { width: number; height: number } };
  const width = gifMeta.lsd.width;
  const height = gifMeta.lsd.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const patchCanvas = document.createElement("canvas");
  const patchCtx = patchCanvas.getContext("2d");
  if (!patchCtx) throw new Error("Canvas is not available in this browser.");

  const frames: SourceFrame[] = [];

  decoded.forEach((frame, index) => {
    const before = ctx.getImageData(0, 0, width, height);
    const patch = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    patchCtx.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
    patchCtx.putImageData(patch, 0, 0);
    ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    const imageData = ctx.getImageData(0, 0, width, height);
    frames.push({
      index,
      imageData,
      delay: Math.max(20, frame.delay || 100),
      thumbnail: canvas.toDataURL("image/webp", 0.7),
    });

    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
    if (frame.disposalType === 3) {
      ctx.putImageData(before, 0, 0);
    }
  });

  return { id: crypto.randomUUID(), name, width, height, frames, sourceDataUrl };
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem(themeStorageKey);
    return saved === "light" ? "light" : "dark";
  });
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("Import a GIF to begin.");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportFileSize, setExportFileSize] = useState<number | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isIconModalOpen, setIsIconModalOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings);
  const [iconSearchTerm, setIconSearchTerm] = useState("");
  const [iconOrder, setIconOrder] = useState<MagnificIconOrder>("recent");
  const [iconStyleFilter, setIconStyleFilter] = useState<MagnificIconStyleFilter>("all");
  const [iconResults, setIconResults] = useState<MagnificIcon[]>([]);
  const [iconPagination, setIconPagination] = useState<MagnificPagination>(initialMagnificPagination);
  const [iconLoading, setIconLoading] = useState(false);
  const [iconError, setIconError] = useState("");
  const [iconImportingId, setIconImportingId] = useState<number | null>(null);
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<Record<string, Effect[]>>({});
  const [history, setHistory] = useState<{ past: EditorState[]; future: EditorState[] }>({ past: [], future: [] });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedEffectId, setDraggedEffectId] = useState<string | null>(null);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [colorPickTarget, setColorPickTarget] = useState<ColorPickTarget | null>(null);
  const [effectScope, setEffectScope] = useState<EffectScope>("global");
  const [liveThumbnails, setLiveThumbnails] = useState<Record<number, string>>({});
  const [liveAssetThumbnails, setLiveAssetThumbnails] = useState<Record<string, string>>({});
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerPan, setViewerPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const exportPreviewRef = useRef<HTMLCanvasElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ pointer: PanPoint; pan: PanPoint } | null>(null);
  const activeAsset = useMemo(() => project?.assets.find((asset) => asset.id === project.activeAssetId) ?? null, [project]);
  const projectEffects = project?.projectEffects ?? [];
  const editor = useMemo(() => {
    if (!project || !activeAsset) return initialEditor;
    return project.editors[activeAsset.id] ?? createDefaultEditor();
  }, [activeAsset, project]);
  const playableFrames = useMemo(() => getPlayableFrames(activeAsset, editor), [activeAsset, editor]);
  const outputSize = useMemo(() => (activeAsset ? getOutputSize(activeAsset, editor) : null), [activeAsset, editor]);
  const selectedFrame = playableFrames[Math.min(currentFrame, Math.max(0, playableFrames.length - 1))];
  const activeFrameKey = selectedFrame ? String(selectedFrame.index) : "";
  const activeEffects = effectScope === "project"
    ? projectEffects
    : effectScope === "frame" && activeFrameKey
      ? editor.frameEffects[activeFrameKey] ?? []
      : editor.effects;
  const timing = getTimingEffect(editor.effects);
  const canSavePreset = activeEffects.length > 0;
  const exportBaseName = exportSettings.fileName.trim() || "edited-animation";
  const isAnyModalOpen = isExportModalOpen || isIconModalOpen;
  const isDragDropEnabled = !isAnyModalOpen;
  const filteredIconResults = useMemo(() => {
    const styleName = magnificStyleNames[iconStyleFilter];
    if (!styleName) return iconResults;
    return iconResults.filter((icon) => icon.style.name === styleName);
  }, [iconResults, iconStyleFilter]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!activeAsset) {
      setIsPlaying(false);
      return;
    }
    setHistory({ past: [], future: [] });
    setCurrentFrame(0);
    setIsPlaying(true);
    setEffectScope("global");
    setLiveThumbnails({});
    setExportSettings((value) => ({
      ...value,
      fileName: activeAsset.name.replace(/\.gif$/i, "") || defaultExportSettings.fileName,
    }));
    resetViewer();
  }, [activeAsset?.id]);

  useEffect(() => {
    if (!project || !activeAsset) return;
    window.localStorage.setItem(autosaveKey, JSON.stringify(editor));
  }, [activeAsset, editor, project]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(presetStorageKey);
      setSavedPresets(saved ? (JSON.parse(saved) as Record<string, Effect[]>) : {});
    } catch {
      setSavedPresets({});
    }
  }, []);

  useEffect(() => {
    if (!activeAsset || !selectedFrame || !previewRef.current) return;
    renderFrame(previewRef.current, selectedFrame, activeAsset, editor, projectEffects);
  }, [activeAsset, selectedFrame, editor, projectEffects]);

  useEffect(() => {
    if (!isExportModalOpen || !activeAsset || !selectedFrame || !exportPreviewRef.current) return;
    renderFrame(exportPreviewRef.current, selectedFrame, activeAsset, editor, projectEffects);
  }, [activeAsset, editor, isExportModalOpen, projectEffects, selectedFrame]);

  useEffect(() => {
    if (!isAnyModalOpen) return;
    setIsDragging(false);
    setDraggedAssetId(null);
    setDraggedEffectId(null);
  }, [isAnyModalOpen]);

  useEffect(() => {
    if (!isIconModalOpen) return;
    void loadMagnificIcons(1, false);
  }, [isIconModalOpen]);

  useEffect(() => {
    if (!outputSize || !monitorRef.current) return;

    const updateFitScale = () => {
      const rect = monitorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const fit = Math.min(1, (rect.width - 40) / outputSize.width, (rect.height - 40) / outputSize.height);
      setFitScale(Math.max(0.05, fit));
    };

    updateFitScale();
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(monitorRef.current);
    return () => observer.disconnect();
  }, [outputSize]);

  useEffect(() => {
    if (!isPlaying || playableFrames.length === 0) return;
    const frame = playableFrames[currentFrame] ?? playableFrames[0];
    const delay = Math.max(20, frame.delay / timing.speed);
    const timer = window.setTimeout(() => {
      setCurrentFrame((index) => (index + 1) % playableFrames.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentFrame, isPlaying, playableFrames, timing.speed]);

  useEffect(() => {
    if (!activeAsset || playableFrames.length === 0) {
      setLiveThumbnails({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next: Record<number, string> = {};
      playableFrames.forEach((frame) => {
        if (!cancelled) next[frame.index] = renderFrameThumbnail(frame, activeAsset, editor, projectEffects);
      });
      if (!cancelled) setLiveThumbnails(next);
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeAsset, editor, playableFrames, projectEffects]);

  useEffect(() => {
    if (!project || project.assets.length === 0) {
      setLiveAssetThumbnails({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next: Record<string, string> = {};
      project.assets.forEach((asset) => {
        const firstFrame = asset.frames[0];
        if (!firstFrame || cancelled) return;
        next[asset.id] = renderAssetThumbnail(firstFrame, asset, project.editors[asset.id] ?? createDefaultEditor(), project.projectEffects);
      });
      if (!cancelled) setLiveAssetThumbnails(next);
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project]);

  function updateEditor(next: Partial<EditorState>) {
    if (!project || !activeAsset) return;
    setHistory((current) => ({ past: [...current.past, editor].slice(-50), future: [] }));
    setProject({
      ...project,
      editors: {
        ...project.editors,
        [activeAsset.id]: { ...editor, ...next },
      },
    });
    setDownloadUrl(null);
  }

  function updateActiveEffects(effects: Effect[]) {
    if (effectScope === "project") {
      if (!project) return;
      setProject({ ...project, projectEffects: effects });
      setDownloadUrl(null);
      return;
    }

    if (effectScope === "frame" && activeFrameKey) {
      updateEditor({ frameEffects: { ...editor.frameEffects, [activeFrameKey]: effects } });
      return;
    }

    updateEditor({ effects });
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) {
      setStatus("Enter a preset name first.");
      return;
    }

    const presetEffects = activeEffects;
    if (presetEffects.length === 0) {
      setStatus("Add at least one stack effect before saving a preset.");
      return;
    }

    const next = { ...savedPresets, [name]: presetEffects };
    setSavedPresets(next);
    window.localStorage.setItem(presetStorageKey, JSON.stringify(next));
    setStatus(`Saved preset ${name}.`);
  }

  function loadPreset(name: string) {
    const preset = savedPresets[name];
    if (!preset) return;
    updateActiveEffects(preset.map((effect) => ({ ...effect, id: `${effect.kind}-${crypto.randomUUID()}` } as Effect)));
    setStatus(`Loaded preset ${name}.`);
  }

  function resetViewer() {
    setViewerZoom(1);
    setViewerPan({ x: 0, y: 0 });
    setIsPanning(false);
    panStartRef.current = null;
  }

  function zoomViewer(nextZoom: number) {
    const zoom = Math.max(0.25, Math.min(8, nextZoom));
    setViewerZoom(zoom);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (colorPickTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    panStartRef.current = { pointer: { x: event.clientX, y: event.clientY }, pan: viewerPan };
  }

  function wheelZoom(event: React.WheelEvent<HTMLDivElement>) {
    if (!project) return;
    event.preventDefault();
    const nextZoom = Math.max(0.25, Math.min(8, viewerZoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const ratio = nextZoom / viewerZoom;
    setViewerPan({
      x: pointerX - (pointerX - viewerPan.x) * ratio,
      y: pointerY - (pointerY - viewerPan.y) * ratio,
    });
    setViewerZoom(nextZoom);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    if (!isPanning || !panStartRef.current) return;
    const dx = event.clientX - panStartRef.current.pointer.x;
    const dy = event.clientY - panStartRef.current.pointer.y;
    setViewerPan({ x: panStartRef.current.pan.x + dx, y: panStartRef.current.pan.y + dy });
  }

  function stopPan(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
    panStartRef.current = null;
  }

  function updateEffect(id: string, next: Partial<Effect>) {
    updateActiveEffects(activeEffects.map((effect) => (effect.id === id ? ({ ...effect, ...next } as Effect) : effect)));
  }

  function addEffect(kind: EffectKind) {
    updateActiveEffects([...activeEffects, createEffect(kind)]);
  }

  function removeEffect(id: string) {
    updateActiveEffects(activeEffects.filter((effect) => effect.id !== id));
  }

  function moveEffect(id: string, direction: -1 | 1) {
    const index = activeEffects.findIndex((effect) => effect.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= activeEffects.length) return;
    const effects = [...activeEffects];
    [effects[index], effects[nextIndex]] = [effects[nextIndex], effects[index]];
    updateActiveEffects(effects);
  }

  function updateEffectColor(target: ColorPickTarget, color: string) {
    updateEffect(target.effectId, { [target.field]: color } as Partial<Effect>);
  }

  function startPreviewColorPick(target: ColorPickTarget) {
    setColorPickTarget(target);
    setStatus("Click a pixel in the preview monitor to sample its color.");
  }

  function samplePreviewColor(event: MouseEvent<HTMLCanvasElement>) {
    if (!colorPickTarget || !previewRef.current) return;
    const canvas = previewRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    const ctx = canvas.getContext("2d");
    if (!ctx || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;

    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    updateEffectColor(colorPickTarget, rgbToHex(r, g, b));
    setColorPickTarget(null);
    setStatus("Color sampled from preview.");
  }

  function reorderEffect(sourceId: string, targetId: string) {
    if (!isDragDropEnabled || sourceId === targetId) return;
    const sourceIndex = activeEffects.findIndex((effect) => effect.id === sourceId);
    const targetIndex = activeEffects.findIndex((effect) => effect.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const effects = [...activeEffects];
    const [moved] = effects.splice(sourceIndex, 1);
    effects.splice(targetIndex, 0, moved);
    updateActiveEffects(effects);
  }

  function undo() {
    if (!project || !activeAsset) return;
    const previous = history.past.at(-1);
    if (!previous) return;
    setProject({
      ...project,
      editors: {
        ...project.editors,
        [activeAsset.id]: previous,
      },
    });
    setHistory({ past: history.past.slice(0, -1), future: [editor, ...history.future] });
    setDownloadUrl(null);
  }

  function redo() {
    if (!project || !activeAsset) return;
    const next = history.future[0];
    if (!next) return;
    setProject({
      ...project,
      editors: {
        ...project.editors,
        [activeAsset.id]: next,
      },
    });
    setHistory({ past: [...history.past, editor].slice(-50), future: history.future.slice(1) });
    setDownloadUrl(null);
  }

  async function appendGifFiles(files: File[]) {
    const gifFiles = files.filter((file) => file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif"));
    if (gifFiles.length === 0) {
      setStatus("Drop or import one or more .gif files.");
      return;
    }

    setStatus(`Decoding ${gifFiles.length} GIF${gifFiles.length === 1 ? "" : "s"}...`);
    setIsPlaying(false);
    setDownloadUrl(null);

    try {
      const decodedAssets = await Promise.all(
        gifFiles.map(async (file) => {
          const sourceDataUrl = await fileToDataUrl(file);
          const buffer = await file.arrayBuffer();
          return await decodeGifAsset(file.name, buffer, sourceDataUrl);
        }),
      );

      setProject((current) => {
        const assets = [...(current?.assets ?? []), ...decodedAssets];
        const editors = {
          ...(current?.editors ?? {}),
          ...Object.fromEntries(decodedAssets.map((asset) => [asset.id, createDefaultEditor()])),
        };

        return {
        name: current?.name ?? "Open GIF Studio Project",
        activeAssetId: current?.activeAssetId ?? decodedAssets[0].id,
        assets,
        projectEffects: current?.projectEffects ?? [],
        editors,
      } satisfies WorkspaceProject;
      });

      if (!project && decodedAssets[0]) setCurrentFrame(0);
      if (decodedAssets.length > 0) setIsPlaying(true);
      setStatus(`Added ${decodedAssets.length} GIF${decodedAssets.length === 1 ? "" : "s"} to the project.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to decode GIFs.");
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    await appendGifFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!isDragDropEnabled) return;
    if (event.dataTransfer.types.includes("application/x-frameforge-effect") || event.dataTransfer.types.includes("application/x-ogs-asset")) return;
    await appendGifFiles(Array.from(event.dataTransfer.files));
  }

  async function loadMagnificIcons(page = 1, append = false) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(initialMagnificPagination.per_page),
      order: iconOrder,
      thumbnail_size: "128",
    });
    if (iconSearchTerm.trim()) params.set("term", iconSearchTerm.trim());
    params.append("filters[icon_type][]", "animated");

    setIconLoading(true);
    setIconError("");

    try {
      const response = await fetch(`/api/magnific/icons?${params.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Failed to load animated icons.");

      const result = payload as MagnificIconsResponse;
      setIconResults((current) => (append ? [...current, ...result.data] : result.data));
      setIconPagination(result.meta.pagination);
    } catch (error) {
      setIconError(error instanceof Error ? error.message : "Failed to load animated icons.");
    } finally {
      setIconLoading(false);
    }
  }

  async function importMagnificIcon(icon: MagnificIcon) {
    setIconImportingId(icon.id);
    setIconError("");
    setStatus(`Adding ${icon.name} from Magnific...`);

    try {
      const assetResponse = await fetch(`/api/magnific/icons/${icon.id}/download?format=gif`);
      if (!assetResponse.ok) {
        const payload = await assetResponse.json().catch(() => null);
        throw new Error(payload?.message || `Failed to download ${icon.name}.`);
      }

      const blob = await assetResponse.blob();
      const fileHeader = assetResponse.headers.get("content-disposition") || "";
      const matchedName = fileHeader.match(/filename="([^"]+)"/i)?.[1];
      const safeName = matchedName || `${icon.slug || icon.name}.gif`;
      const fileName = safeName.toLowerCase().endsWith(".gif") ? safeName : `${safeName}.gif`;
      const file = new File([blob], fileName, { type: blob.type || "image/gif" });

      await appendGifFiles([file]);
      setIsIconModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to add ${icon.name}.`;
      setIconError(message);
      setStatus(message);
    } finally {
      setIconImportingId(null);
    }
  }

  async function handleProjectImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const saved = JSON.parse(await file.text()) as SavedProject;
      setStatus(`Loading project ${saved.name}...`);
      const assets = await Promise.all(
        saved.assets.map(async (asset) => {
          const buffer = await dataUrlToArrayBuffer(asset.sourceDataUrl);
          const decoded = await decodeGifAsset(asset.name, buffer, asset.sourceDataUrl);
          return { ...decoded, id: asset.id };
        }),
      );

      const editors = Object.fromEntries(
        assets.map((asset) => [asset.id, saved.editors[asset.id] ?? createDefaultEditor()]),
      );

      setProject({
        name: saved.name,
        activeAssetId: saved.activeAssetId || assets[0]?.id || "",
        assets,
        projectEffects: saved.projectEffects ?? [],
        editors,
      });
      setIsPlaying(assets.length > 0);
      setStatus(`Loaded project ${saved.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load project file.");
    }

    event.target.value = "";
  }

  function saveProjectFile() {
    if (!project) return;
    const payload: SavedProject = {
      name: project.name,
      activeAssetId: project.activeAssetId,
      assets: project.assets.map((asset) => ({ id: asset.id, name: asset.name, sourceDataUrl: asset.sourceDataUrl })),
      projectEffects: project.projectEffects,
      editors: project.editors,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name.replace(/\s+/g, "-").toLowerCase() || "ogs-project"}.ogsp.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renameAsset(assetId: string, name: string) {
    if (!project) return;
    setProject({
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, name } : asset)),
    });
  }

  function removeAsset(assetId: string) {
    if (!project) return;
    const assets = project.assets.filter((asset) => asset.id !== assetId);
    const { [assetId]: _removed, ...editors } = project.editors;
    setProject(
      assets.length === 0
        ? null
        : {
            ...project,
            activeAssetId: project.activeAssetId === assetId ? assets[0].id : project.activeAssetId,
            assets,
            editors,
          },
    );
    if (project.activeAssetId === assetId) {
      setCurrentFrame(0);
      setEffectScope("global");
    }
  }

  function reorderAssets(sourceId: string, targetId: string) {
    if (!project || !isDragDropEnabled || sourceId === targetId) return;
    const sourceIndex = project.assets.findIndex((asset) => asset.id === sourceId);
    const targetIndex = project.assets.findIndex((asset) => asset.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const assets = [...project.assets];
    const [moved] = assets.splice(sourceIndex, 1);
    assets.splice(targetIndex, 0, moved);
    setProject({ ...project, assets });
  }

  function resetEdits() {
    if (!project || !activeAsset) return;
    setHistory((value) => ({ past: [...value.past, editor].slice(-50), future: [] }));
    setProject({
      ...project,
      editors: {
        ...project.editors,
        [activeAsset.id]: createDefaultEditor(),
      },
    });
    setCurrentFrame(0);
    setDownloadUrl(null);
    setExportFileSize(null);
  }

  function openExportModal() {
    if (!activeAsset) return;
    setIsExportModalOpen(true);
  }

  function openIconModal() {
    setIconResults([]);
    setIconPagination(initialMagnificPagination);
    setIconError("");
    setIsIconModalOpen(true);
  }

  function closeIconModal() {
    if (iconImportingId !== null) return;
    setIsIconModalOpen(false);
  }

  function closeExportModal() {
    if (exportProgress !== null) return;
    setIsExportModalOpen(false);
  }

  function exportGif() {
    if (!activeAsset || playableFrames.length === 0) return;
    setIsPlaying(false);
    setExportProgress(0);
    setStatus("Rendering GIF export...");
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setExportFileSize(null);

    const { width, height } = getOutputSize(activeAsset, editor);
    const gif = new GIF({
      workers: exportSettings.workers,
      quality: exportSettings.quality,
      width,
      height,
      workerScript,
      repeat: timing.loopCount,
      background: "#ff00ff",
      transparent: transparencyKeyNumber,
      dither: exportSettings.dither,
    });
    const canvas = document.createElement("canvas");

    playableFrames.forEach((frame) => {
      renderFrame(canvas, frame, activeAsset, editor, projectEffects);
      if (exportSettings.optimizeTransparency) prepareGifTransparency(canvas);
      gif.addFrame(canvas, { copy: true, delay: Math.max(20, frame.delay / timing.speed) });
    });

    gif.on("progress", (progress) => setExportProgress(progress));
    gif.on("finished", (blob) => {
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setExportFileSize(blob.size);
      setExportProgress(null);
      setStatus(`Export complete: ${(blob.size / 1024 / 1024).toFixed(2)} MB.`);
    });
    gif.render();
  }

  const canEdit = activeAsset !== null;
  const effectScopeLabel = effectScope === "project" ? "project" : effectScope === "frame" ? "frame" : "whole GIF";

  return (
    <main
      data-theme={themeMode}
      className={isDragging ? "app-shell dragging" : "app-shell"}
      onDragEnter={(event) => {
        if (!isDragDropEnabled) return;
        event.preventDefault();
        if (event.dataTransfer.types.includes("application/x-frameforge-effect") || event.dataTransfer.types.includes("application/x-ogs-asset")) return;
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        if (!isDragDropEnabled) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!isDragDropEnabled) return;
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && <div className="drop-overlay">Drop GIF to load</div>}
      <header className="topbar">
        <div className="brand-block">
          <h1>OGS</h1>
          <span>Open GIF Studio</span>
        </div>
        <div className="toolbar">
          <div className="command-group primary-actions">
            <label className="button primary">
              Add GIFs
              <input type="file" accept="image/gif" multiple onChange={handleImport} />
            </label>
            <button className="button export" type="button" disabled={!canEdit} onClick={openExportModal}>
              Export
            </button>
          </div>
          <div className="command-group">
            <label className="button quiet">
              Load
              <input ref={projectInputRef} type="file" accept="application/json,.json,.ogsp.json" onChange={handleProjectImport} />
            </label>
            <button className="button quiet" type="button" disabled={!project} onClick={saveProjectFile}>Save</button>
            <button className="button quiet" type="button" disabled={history.past.length === 0} onClick={undo}>Undo</button>
            <button className="button quiet" type="button" disabled={history.future.length === 0} onClick={redo}>Redo</button>
            <button className="button quiet" type="button" disabled={!canEdit} onClick={resetEdits}>Reset</button>
          </div>
          <div className="command-group utility-links">
            <button className="theme-switch" type="button" onClick={() => setThemeMode((value) => (value === "dark" ? "light" : "dark"))} aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}>
              <span>{themeMode === "dark" ? "Dark" : "Light"}</span>
              <strong>{themeMode === "dark" ? "Light" : "Dark"}</strong>
            </button>
            <a className="icon-link" href={repoUrl} target="_blank" rel="noreferrer" aria-label="Open GitHub repository" title="GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-1.96c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.56-.29-5.24-1.28-5.24-5.72 0-1.26.45-2.3 1.2-3.12-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.2a11.1 11.1 0 0 1 5.79 0c2.2-1.51 3.17-1.2 3.17-1.2.63 1.59.23 2.76.11 3.05.75.82 1.2 1.86 1.2 3.12 0 4.45-2.69 5.42-5.26 5.7.42.37.78 1.08.78 2.18v3.23c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
            </a>
            <a className="icon-link" href={donationUrl} target="_blank" rel="noreferrer" aria-label="Buy me a coffee" title="Buy me a coffee">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6h1.5A3.5 3.5 0 0 1 23 9.5v.5A3.5 3.5 0 0 1 19.5 13H18v1a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V6h12Zm0 2v3h1.5A1.5 1.5 0 0 0 21 9.5v-.5A1.5 1.5 0 0 0 19.5 8H18ZM6 20h12v2H6v-2Z"/></svg>
            </a>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel media-bin">
          <div className="panel-head">
            <h2>Media Bin</h2>
          </div>
          <>
              {project ? (
                <>
                  <div className="asset-list">
                    {project.assets.map((asset) => (
                      <div
                        className={[asset.id === project.activeAssetId ? "asset-card active" : "asset-card", draggedAssetId === asset.id ? "dragging" : ""].filter(Boolean).join(" ")}
                        key={asset.id}
                        onDragOver={(event) => {
                          if (!isDragDropEnabled) return;
                          if (!event.dataTransfer.types.includes("application/x-ogs-asset")) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (!isDragDropEnabled) return;
                          const sourceId = event.dataTransfer.getData("application/x-ogs-asset") || draggedAssetId;
                          if (sourceId) reorderAssets(sourceId, asset.id);
                          setDraggedAssetId(null);
                        }}
                      >
                        <button
                          className="asset-thumb-button"
                          type="button"
                          onClick={() => {
                            setProject({ ...project, activeAssetId: asset.id });
                            setCurrentFrame(0);
                          }}
                        >
                          <img className="asset-thumb" src={liveAssetThumbnails[asset.id] ?? asset.frames[0]?.thumbnail} alt="" />
                        </button>
                        <div className="asset-meta">
                          <div className="asset-header">
                            <div className="asset-row">
                              <span
                                className="drag-handle asset-drag"
                                draggable={isDragDropEnabled}
                                aria-label={`Drag ${asset.name}`}
                                role="button"
                                onDragStart={(event) => {
                                  if (!isDragDropEnabled) return;
                                  event.stopPropagation();
                                  setIsDragging(false);
                                  setDraggedAssetId(asset.id);
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("application/x-ogs-asset", asset.id);
                                  event.dataTransfer.setData("text/plain", asset.id);
                                }}
                                onDragEnd={() => setDraggedAssetId(null)}
                              >
                                ::
                              </span>
                              <span className="asset-icon">GIF</span>
                              {asset.id === project.activeAssetId && <span className="asset-badge">Active</span>}
                            </div>
                            <button className="mini-button danger asset-remove" type="button" onClick={() => removeAsset(asset.id)}>
                              Remove
                            </button>
                          </div>
                          <input
                            className="asset-name-input"
                            type="text"
                            value={asset.name}
                            onChange={(event) => renameAsset(asset.id, event.target.value)}
                          />
                          <button
                            className="asset-open"
                            type="button"
                            onClick={() => {
                              setProject({ ...project, activeAssetId: asset.id });
                              setCurrentFrame(0);
                            }}
                          >
                            {asset.width} x {asset.height} · {asset.frames.length} frames
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="readout-grid compact">
                    <span>Selection</span>
                    <strong>{rangeLabel(activeAsset, editor)}</strong>
                    <span>Output</span>
                    <strong>{outputSize ? `${outputSize.width} x ${outputSize.height}` : "-"}</strong>
                    <span>Loop</span>
                    <strong>{timing.loopCount === 0 ? "Forever" : `${timing.loopCount}x`}</strong>
                  </div>
                  <div className="asset-actions empty">
                    <button className="button" type="button" onClick={openIconModal}>
                      Animated Icons
                    </button>
                  </div>
                </>
              ) : (
                <label className="drop-copy">
                  <strong>No source loaded</strong>
                  <span>Import or drop one or more animated GIFs to build a project.</span>
                  <input type="file" accept="image/gif" multiple onChange={handleImport} />
                </label>
              )}
              {!project && (
                <div className="asset-actions empty">
                  <button className="button" type="button" onClick={openIconModal}>
                    Animated Icons
                  </button>
                </div>
              )}
            </>
        </aside>

        <section className="monitor-stage">
          <div className="monitor-head">
            <span>{status}</span>
            <div className="viewer-controls">
              {exportProgress !== null && <span>{Math.round(exportProgress * 100)}%</span>}
              <button className="mini-button" type="button" disabled={!canEdit} onClick={() => zoomViewer(viewerZoom - 0.25)}>-</button>
              <span>{Math.round(fitScale * viewerZoom * 100)}%</span>
              <button className="mini-button" type="button" disabled={!canEdit} onClick={() => zoomViewer(viewerZoom + 0.25)}>+</button>
              <button className="mini-button" type="button" disabled={!canEdit} onClick={resetViewer}>Fit</button>
            </div>
          </div>
          <>
              <div
                className={["monitor", activeAsset ? "pannable" : "", isPanning ? "panning" : ""].filter(Boolean).join(" ")}
                ref={monitorRef}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={stopPan}
                onPointerCancel={stopPan}
                onWheel={wheelZoom}
              >
                {activeAsset ? (
                  <div
                    className="viewer-canvas-wrap"
                    style={{ transform: `translate(${viewerPan.x}px, ${viewerPan.y}px)` }}
                  >
                    <canvas
                      className={colorPickTarget ? "sampling" : ""}
                      ref={previewRef}
                      onClick={samplePreviewColor}
                      style={outputSize ? { width: `${outputSize.width * fitScale * viewerZoom}px`, height: `${outputSize.height * fitScale * viewerZoom}px` } : undefined}
                    />
                  </div>
                ) : null}
              </div>
              <div className="transport">
                <button className="button" type="button" disabled={!canEdit} onClick={() => setCurrentFrame(0)}>
                  Start
                </button>
                <button className="button primary" type="button" disabled={!canEdit} onClick={() => setIsPlaying((value) => !value)}>
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setCurrentFrame((index) => Math.max(0, index - 1))}
                >
                  -1 frame
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setCurrentFrame((index) => Math.min(playableFrames.length - 1, index + 1))}
                >
                  +1 frame
                </button>
              </div>
            </>
        </section>

        <aside className="panel inspector">
          <div className="panel-head sticky">
            <h2>Effects</h2>
          </div>

          <div className={canEdit ? "stack-panel" : "stack-panel disabled"}>
            <div className="scope-toggle">
              <button className={effectScope === "project" ? "toggle active" : "toggle"} type="button" onClick={() => setEffectScope("project")}>
                Project
              </button>
              <button className={effectScope === "global" ? "toggle active" : "toggle"} type="button" onClick={() => setEffectScope("global")}>
                Whole GIF
              </button>
              <button className={effectScope === "frame" ? "toggle active" : "toggle"} type="button" disabled={!selectedFrame} onClick={() => setEffectScope("frame")}>
                Frame {selectedFrame ? selectedFrame.index + 1 : "-"}
              </button>
            </div>
            <div className="effect-tools">
              <select
                aria-label="Add effect"
                value=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  addEffect(event.target.value as EffectKind);
                  event.target.value = "";
                }}
              >
                <option value="">Choose effect...</option>
                {effectScope === "global" && <option value="timing">Timing</option>}
                {effectScope === "global" && <option value="transform">Transform</option>}
                <option value="adjust">Color adjust</option>
                <option value="preset">Preset</option>
                <option value="tint">Tint</option>
                <option value="color-replace">Color replacement</option>
                <option value="background-removal">Background removal</option>
                <option value="blur">Blur</option>
                <option value="vignette">Vignette</option>
                <option value="noise">Noise</option>
              </select>

              <div className="preset-row">
                <input aria-label="Preset name" type="text" placeholder="Preset name" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
                <button className="mini-button" type="button" disabled={!canSavePreset} onClick={savePreset}>Save</button>
              </div>

              <select aria-label="Load preset" value="" onChange={(event) => {
                if (!event.target.value) return;
                loadPreset(event.target.value);
                event.target.value = "";
              }}>
                <option value="">Load preset...</option>
                {Object.keys(savedPresets).sort().map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>

            <div className="effect-stack">
              {activeEffects.length === 0 && (
                <div className="empty-stack">No {effectScopeLabel} effects yet.</div>
              )}
              {activeEffects.map((effect, index) => (
                <section
                  className={[effect.enabled ? "effect-card" : "effect-card disabled", draggedEffectId === effect.id ? "dragging" : ""].filter(Boolean).join(" ")}
                  key={effect.id}
                  onDragOver={(event) => {
                    if (!isDragDropEnabled) return;
                    if (!event.dataTransfer.types.includes("application/x-frameforge-effect")) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!isDragDropEnabled) return;
                    const sourceId = event.dataTransfer.getData("text/plain") || draggedEffectId;
                    if (sourceId) reorderEffect(sourceId, effect.id);
                    setDraggedEffectId(null);
                  }}
                  onDragEnd={() => setDraggedEffectId(null)}
                >
                  <div className="effect-card-head">
                    <strong>
                      <span
                        className="drag-handle"
                        draggable={isDragDropEnabled}
                        aria-label={`Drag ${effectName(effect)} effect`}
                        role="button"
                        onDragStart={(event) => {
                          if (!isDragDropEnabled) return;
                          event.stopPropagation();
                          setIsDragging(false);
                          setDraggedEffectId(effect.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-frameforge-effect", effect.id);
                          event.dataTransfer.setData("text/plain", effect.id);
                        }}
                        onDragEnd={(event) => {
                          event.stopPropagation();
                          setDraggedEffectId(null);
                        }}
                      >
                        ::
                      </span>
                      {index + 1}. {effectName(effect)}
                    </strong>
                    <div className="effect-actions">
                      <button className="mini-button" type="button" onClick={() => moveEffect(effect.id, -1)} disabled={index === 0}>Up</button>
                      <button className="mini-button" type="button" onClick={() => moveEffect(effect.id, 1)} disabled={index === activeEffects.length - 1}>Down</button>
                      <button className="mini-button" type="button" onClick={() => updateEffect(effect.id, { enabled: !effect.enabled })}>{effect.enabled ? "Off" : "On"}</button>
                      <button className="mini-button danger" type="button" onClick={() => removeEffect(effect.id)}>Remove</button>
                    </div>
                  </div>

                  {effect.kind === "timing" && (
                    <>
                      <label>
                        Trim start
                        <input type="range" min="0" max={Math.max(0, (activeAsset?.frames.length ?? 1) - 1)} value={effect.trimStart} onChange={(event) => updateEffect(effect.id, { trimStart: Number(event.target.value) })} />
                      </label>
                      <label>
                        Trim end
                        <input type="range" min="0" max={Math.max(0, (activeAsset?.frames.length ?? 1) - 1)} value={effect.trimEnd} onChange={(event) => updateEffect(effect.id, { trimEnd: Number(event.target.value) })} />
                      </label>
                      <label>Speed {effect.speed.toFixed(2)}x<input type="range" min="0.25" max="4" step="0.25" value={effect.speed} onChange={(event) => updateEffect(effect.id, { speed: Number(event.target.value) })} /></label>
                      <label>Loop count<input type="number" min="0" max="20" value={effect.loopCount} onChange={(event) => updateEffect(effect.id, { loopCount: Number(event.target.value) })} /></label>
                      <button className="toggle" type="button" onClick={() => updateEffect(effect.id, { reverse: !effect.reverse })}>Reverse: {effect.reverse ? "On" : "Off"}</button>
                    </>
                  )}

                  {effect.kind === "transform" && (
                    <>
                      <label>Rotate {effect.rotate}deg<input type="range" min="-180" max="180" value={effect.rotate} onChange={(event) => updateEffect(effect.id, { rotate: Number(event.target.value) })} /></label>
                      <label>Scale {Math.round(effect.scale * 100)}%<input type="range" min="0.25" max="2" step="0.05" value={effect.scale} onChange={(event) => updateEffect(effect.id, { scale: Number(event.target.value) })} /></label>
                      <label>Crop left {effect.cropLeft}%<input type="range" min="0" max={100 - effect.cropWidth} value={effect.cropLeft} onChange={(event) => updateEffect(effect.id, { cropLeft: Number(event.target.value) })} /></label>
                      <label>Crop top {effect.cropTop}%<input type="range" min="0" max={100 - effect.cropHeight} value={effect.cropTop} onChange={(event) => updateEffect(effect.id, { cropTop: Number(event.target.value) })} /></label>
                      <label>Crop width {effect.cropWidth}%<input type="range" min="10" max={100 - effect.cropLeft} value={effect.cropWidth} onChange={(event) => updateEffect(effect.id, { cropWidth: Number(event.target.value) })} /></label>
                      <label>Crop height {effect.cropHeight}%<input type="range" min="10" max={100 - effect.cropTop} value={effect.cropHeight} onChange={(event) => updateEffect(effect.id, { cropHeight: Number(event.target.value) })} /></label>
                      <div className="split-buttons">
                        <button className="toggle" type="button" onClick={() => updateEffect(effect.id, { flipH: !effect.flipH })}>Flip H</button>
                        <button className="toggle" type="button" onClick={() => updateEffect(effect.id, { flipV: !effect.flipV })}>Flip V</button>
                      </div>
                    </>
                  )}

                  {effect.kind === "preset" && (
                    <label>
                      Preset
                      <select value={effect.preset} onChange={(event) => updateEffect(effect.id, { preset: event.target.value as Preset })}>
                        <option value="grayscale">Grayscale</option>
                        <option value="sepia">Sepia</option>
                        <option value="monochrome">Monochrome</option>
                        <option value="invert">Negative</option>
                      </select>
                    </label>
                  )}

                  {effect.kind === "adjust" && (
                    <>
                      <label>Brightness {effect.brightness}<input type="range" min="-100" max="100" value={effect.brightness} onChange={(event) => updateEffect(effect.id, { brightness: Number(event.target.value) })} /></label>
                      <label>Contrast {effect.contrast}<input type="range" min="-100" max="100" value={effect.contrast} onChange={(event) => updateEffect(effect.id, { contrast: Number(event.target.value) })} /></label>
                      <label>Saturation {effect.saturation}<input type="range" min="-100" max="100" value={effect.saturation} onChange={(event) => updateEffect(effect.id, { saturation: Number(event.target.value) })} /></label>
                      <label>Lightness {effect.lightness}<input type="range" min="-100" max="100" value={effect.lightness} onChange={(event) => updateEffect(effect.id, { lightness: Number(event.target.value) })} /></label>
                      <label>Hue {effect.hue}deg<input type="range" min="-180" max="180" value={effect.hue} onChange={(event) => updateEffect(effect.id, { hue: Number(event.target.value) })} /></label>
                    </>
                  )}

                  {effect.kind === "tint" && (
                    <>
                      <ColorField label="Tint color" value={effect.color} onChange={(color) => updateEffect(effect.id, { color })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "color" })} />
                      <label>Tint mix {effect.amount}%<input type="range" min="0" max="100" value={effect.amount} onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value) })} /></label>
                    </>
                  )}

                  {effect.kind === "color-replace" && (
                    <>
                      <ColorField label="Change color" value={effect.from} onChange={(from) => updateEffect(effect.id, { from })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "from" })} />
                      <ColorField label="To color" value={effect.to} onChange={(to) => updateEffect(effect.id, { to })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "to" })} />
                      <label>Tolerance {effect.tolerance}%<input type="range" min="0" max="100" value={effect.tolerance} onChange={(event) => updateEffect(effect.id, { tolerance: Number(event.target.value) })} /></label>
                      <label>Softness {effect.softness}%<input type="range" min="0" max="100" value={effect.softness} onChange={(event) => updateEffect(effect.id, { softness: Number(event.target.value) })} /></label>
                    </>
                  )}

                  {effect.kind === "background-removal" && (
                    <>
                      <ColorField label="Remove color" value={effect.color} onChange={(color) => updateEffect(effect.id, { color })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "color" })} />
                      <label>Tolerance {effect.tolerance}%<input type="range" min="0" max="100" value={effect.tolerance} onChange={(event) => updateEffect(effect.id, { tolerance: Number(event.target.value) })} /></label>
                      <label>Softness {effect.softness}%<input type="range" min="0" max="100" value={effect.softness} onChange={(event) => updateEffect(effect.id, { softness: Number(event.target.value) })} /></label>
                    </>
                  )}

                  {effect.kind === "blur" && <label>Radius {effect.radius}px<input type="range" min="0" max="12" step="0.5" value={effect.radius} onChange={(event) => updateEffect(effect.id, { radius: Number(event.target.value) })} /></label>}
                  {effect.kind === "vignette" && <label>Amount {effect.amount}%<input type="range" min="0" max="100" value={effect.amount} onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value) })} /></label>}
                  {effect.kind === "noise" && <label>Amount {effect.amount}%<input type="range" min="0" max="60" value={effect.amount} onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value) })} /></label>}
                </section>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="timeline">
        <div className="timeline-head">
          <strong>Timeline</strong>
          <div className="viewer-controls">
            <span>{activeAsset ? `Frame ${Math.min(currentFrame + 1, playableFrames.length)} / ${playableFrames.length}` : "Waiting for media"}</span>
          </div>
        </div>
        <>
            <input
              className="scrubber"
              type="range"
              min="0"
              max={Math.max(0, playableFrames.length - 1)}
              value={Math.min(currentFrame, Math.max(0, playableFrames.length - 1))}
              disabled={!canEdit}
              onChange={(event) => {
                setIsPlaying(false);
                setCurrentFrame(Number(event.target.value));
              }}
            />
            <div className="frame-strip">
              {playableFrames.map((frame, index) => (
                <button
                  className={index === currentFrame ? "frame-chip active" : "frame-chip"}
                  key={`${frame.index}-${index}`}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentFrame(index);
                    setEffectScope("frame");
                  }}
                >
                  <img src={liveThumbnails[frame.index] ?? frame.thumbnail} alt={`Frame ${frame.index + 1}`} />
                  <span>{frame.index + 1}</span>
                </button>
              ))}
            </div>
          </>
      </section>

      {isExportModalOpen && (
        <div className="modal-backdrop" onClick={closeExportModal}>
          <section className="modal export-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Export GIF</h2>
                <p className="modal-copy">Choose file name, quality, and optimization before rendering.</p>
              </div>
              <button className="mini-button" type="button" onClick={closeExportModal} disabled={exportProgress !== null}>Close</button>
            </div>

            <div className="export-preview">
              <div className="export-preview-head">
                <span>Render preview</span>
                <strong>{selectedFrame ? `Frame ${selectedFrame.index + 1}` : "No frame"}</strong>
              </div>
              <div className="export-preview-stage">
                <canvas ref={exportPreviewRef} />
              </div>
            </div>

            <div className="modal-grid">
              <label>
                Save as
                <input type="text" value={exportSettings.fileName} onChange={(event) => setExportSettings((value) => ({ ...value, fileName: event.target.value }))} />
              </label>
              <label>
                Encoder quality {exportSettings.quality}
                <input type="range" min="1" max="20" value={exportSettings.quality} onChange={(event) => setExportSettings((value) => ({ ...value, quality: Number(event.target.value) }))} />
              </label>
              <label>
                Worker count
                <input type="number" min="1" max="8" value={exportSettings.workers} onChange={(event) => setExportSettings((value) => ({ ...value, workers: Number(event.target.value) || 1 }))} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={exportSettings.dither} onChange={(event) => setExportSettings((value) => ({ ...value, dither: event.target.checked }))} />
                <span>Enable dithering</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={exportSettings.optimizeTransparency} onChange={(event) => setExportSettings((value) => ({ ...value, optimizeTransparency: event.target.checked }))} />
                <span>Optimize transparency for smaller GIFs</span>
              </label>
            </div>

            <div className="export-summary">
              <span>Output</span>
              <strong>{outputSize ? `${outputSize.width} x ${outputSize.height}` : "-"}</strong>
              <span>Frames</span>
              <strong>{playableFrames.length}</strong>
              <span>Rendered file</span>
              <strong>{exportFileSize !== null ? `${(exportFileSize / 1024 / 1024).toFixed(2)} MB` : "Not rendered yet"}</strong>
            </div>

            <div className="modal-actions">
              <button className="button export" type="button" disabled={!canEdit || exportProgress !== null} onClick={exportGif}>
                {exportProgress !== null ? `Rendering ${Math.round(exportProgress * 100)}%` : "Render GIF"}
              </button>
              {downloadUrl && (
                <a className="button download" href={downloadUrl} download={`${exportBaseName}.gif`}>
                  Download GIF
                </a>
              )}
            </div>
          </section>
        </div>
      )}

      {isIconModalOpen && (
        <div className="modal-backdrop" onClick={closeIconModal}>
          <section className="modal icon-browser-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Animated Icon Browser</h2>
                <p className="modal-copy">Search Magnific animated icons, then add one directly into the project as a GIF.</p>
              </div>
              <button className="mini-button" type="button" onClick={closeIconModal} disabled={iconImportingId !== null}>Close</button>
            </div>

            <form className="icon-search-row" onSubmit={(event) => {
              event.preventDefault();
              void loadMagnificIcons(1, false);
            }}>
              <label>
                Search
                <input type="text" value={iconSearchTerm} placeholder="cat, loader, arrow..." onChange={(event) => setIconSearchTerm(event.target.value)} />
              </label>
              <label>
                Order
                <select value={iconOrder} onChange={(event) => setIconOrder(event.target.value as MagnificIconOrder)}>
                  <option value="recent">Recent</option>
                  <option value="relevance">Relevance</option>
                </select>
              </label>
              <label>
                Style
                <select value={iconStyleFilter} onChange={(event) => setIconStyleFilter(event.target.value as MagnificIconStyleFilter)}>
                  <option value="all">All animated</option>
                  <option value="basic-accent-lineal-color">Basic Accent Lineal Color</option>
                  <option value="basic-accent-outline">Basic Accent Outline</option>
                </select>
              </label>
              <button className="button primary" type="submit" disabled={iconLoading || iconImportingId !== null}>
                {iconLoading ? "Searching..." : "Search"}
              </button>
            </form>

            <div className="icon-browser-summary">
              <span>
                {filteredIconResults.length > 0
                  ? `${filteredIconResults.length} shown of ${iconPagination.total || iconResults.length} animated icons`
                  : iconPagination.total > 0
                    ? `No results match ${magnificStyleNames[iconStyleFilter] ?? "this style filter"}`
                    : "Animated icons only"}
              </span>
              <strong>Page {iconPagination.current_page} of {Math.max(1, iconPagination.last_page)}</strong>
            </div>

            {iconError && <div className="icon-browser-error">{iconError}</div>}

            <div className="icon-results-grid">
              {!iconLoading && filteredIconResults.length === 0 && !iconError && (
                <div className="icon-results-empty">No animated icons matched this search.</div>
              )}
              {filteredIconResults.map((icon) => {
                const thumbnail = icon.thumbnails[0]?.url;
                const isImporting = iconImportingId === icon.id;
                return (
                  <article className="icon-card" key={icon.id}>
                    <div className="icon-card-thumb">
                      {thumbnail ? <img src={thumbnail} alt={icon.name} loading="lazy" /> : <div className="icon-card-fallback">No preview</div>}
                    </div>
                    <div className="icon-card-body">
                      <strong title={icon.name}>{icon.name}</strong>
                      <small>{icon.style.name} · {icon.author.name}</small>
                    </div>
                    <button className="button icon-import-button" type="button" disabled={iconLoading || iconImportingId !== null} onClick={() => void importMagnificIcon(icon)}>
                      {isImporting ? "Adding..." : "Add to project"}
                    </button>
                  </article>
                );
              })}
            </div>

            <div className="modal-actions">
              <button className="button" type="button" disabled={iconLoading || iconImportingId !== null || iconPagination.current_page >= iconPagination.last_page} onClick={() => void loadMagnificIcons(iconPagination.current_page + 1, true)}>
                {iconLoading && iconPagination.current_page > 1 ? "Loading..." : "Load more"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
