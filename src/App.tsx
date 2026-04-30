import { ChangeEvent, DragEvent, MouseEvent, PointerEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import GIF from "gif.js";
import JSZip from "jszip";

type SourceFrame = {
  index: number;
  imageData: ImageData;
  delay: number;
  thumbnail: string;
};

type Preset = "grayscale" | "sepia" | "monochrome" | "invert" | "gotham" | "lomo" | "toaster" | "polaroid" | "nashville";

type EffectKind = "timing" | "transform" | "canvas-style" | "preset" | "adjust" | "tint" | "color-replace" | "blur" | "vignette" | "noise" | "background-removal" | "posterize" | "solarize" | "emboss" | "oil-paint" | "distortion";

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
type CanvasStyleEffect = BaseEffect & { kind: "canvas-style"; backgroundColor: string; transparentBackground: boolean; cornerRadius: number; borderWidth: number; borderColor: string };
type PresetEffect = BaseEffect & { kind: "preset"; preset: Preset };
type AdjustEffect = BaseEffect & { kind: "adjust"; brightness: number; contrast: number; saturation: number; lightness: number; hue: number };
type TintEffect = BaseEffect & { kind: "tint"; color: string; amount: number };
type ColorReplaceEffect = BaseEffect & { kind: "color-replace"; from: string; to: string; tolerance: number; softness: number };
type BlurEffect = BaseEffect & { kind: "blur"; radius: number };
type VignetteEffect = BaseEffect & { kind: "vignette"; amount: number };
type NoiseEffect = BaseEffect & { kind: "noise"; amount: number };
type BackgroundRemovalEffect = BaseEffect & { kind: "background-removal"; color: string; tolerance: number; softness: number };
type PosterizeEffect = BaseEffect & { kind: "posterize"; levels: number };
type SolarizeEffect = BaseEffect & { kind: "solarize"; threshold: number };
type EmbossEffect = BaseEffect & { kind: "emboss"; strength: number };
type OilPaintEffect = BaseEffect & { kind: "oil-paint"; radius: number };
type DistortionEffect = BaseEffect & { kind: "distortion"; mode: "wave" | "swirl" | "implode"; amount: number; radius: number; frequency: number };

type Effect = TimingEffect | TransformEffect | CanvasStyleEffect | PresetEffect | AdjustEffect | TintEffect | ColorReplaceEffect | BlurEffect | VignetteEffect | NoiseEffect | BackgroundRemovalEffect | PosterizeEffect | SolarizeEffect | EmbossEffect | OilPaintEffect | DistortionEffect;
type ColorPickTarget = { effectId: string; field: "color" | "from" | "to" | "backgroundColor" | "borderColor" };
type PanPoint = { x: number; y: number };
type EffectScope = "project" | "global" | "frame";

type EditorState = {
  effects: Effect[];
  frameEffects: Record<string, Effect[]>;
  frameOrder?: number[];
};

type ProjectAsset = {
  id: string;
  name: string;
  width: number;
  height: number;
  frames: SourceFrame[];
  sourceDataUrl: string;
  hidden: boolean;
  ignoreProjectEffects: boolean;
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
    hidden?: boolean;
    ignoreProjectEffects?: boolean;
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

type ImportProgress = {
  completedFiles: number;
  totalFiles: number;
  currentFileName: string;
  currentFileProgress: number;
  overallProgress: number;
};

type GiphyUploadResult = {
  id: string | null;
  url: string | null;
};

type WorkerDecodedFrame = {
  index: number;
  delay: number;
  data: ArrayBuffer;
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
const gifDecodeWorkerUrl = new URL("./gifDecodeWorker.ts", import.meta.url);
const supportedImageAccept = "image/gif,image/png,image/apng,image/webp,image/avif,image/jpeg,image/jpg";
const autosaveKey = "frameforge-editor-state";
const presetStorageKey = "frameforge-effect-presets";
const themeStorageKey = "ogs-theme-mode";
const transparencyKey = { r: 255, g: 0, b: 255 };
const transparencyKeyNumber = 0xff00ff;
const maxGifFileBytes = 25 * 1024 * 1024;
const maxProjectFileBytes = 50 * 1024 * 1024;
const maxGifFrames = 512;
const maxGifDimension = 4096;
const maxGifPixels = 16_000_000;
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

function stripGifExtension(name: string) {
  return name.replace(/\.(gif|apng|png|webp|avif|jpe?g)$/i, "");
}

function normalizeAssetName(name: string, fallback = "animation") {
  const normalized = stripGifExtension(name).trim();
  return normalized || fallback;
}

function safeFileBase(name: string, fallback = "animation") {
  const base = normalizeAssetName(name, fallback)
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-z0-9._ -]/gi, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return base || fallback;
}

function safeProjectFileBase(name: string) {
  return safeFileBase(name, "ogs-project").replace(/\s+/g, "-").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSavedProject(value: unknown): SavedProject {
  if (!isRecord(value)) throw new Error("Invalid project file.");

  const assets = Array.isArray(value.assets) ? value.assets : null;
  if (!assets || assets.length === 0) throw new Error("Project file does not contain any GIF assets.");

  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Open GIF Studio Project",
    activeAssetId: typeof value.activeAssetId === "string" ? value.activeAssetId : "",
    assets: assets.map((asset, index) => {
      if (!isRecord(asset)) throw new Error(`Invalid project asset at index ${index}.`);
      if (typeof asset.sourceDataUrl !== "string" || !asset.sourceDataUrl.startsWith("data:image/")) {
        throw new Error(`Project asset ${index + 1} is missing image source data.`);
      }

      return {
        id: typeof asset.id === "string" && asset.id ? asset.id : crypto.randomUUID(),
        name: normalizeAssetName(typeof asset.name === "string" ? asset.name : "", `animation-${index + 1}`),
        sourceDataUrl: asset.sourceDataUrl,
        hidden: Boolean(asset.hidden),
        ignoreProjectEffects: Boolean(asset.ignoreProjectEffects),
      };
    }),
    projectEffects: Array.isArray(value.projectEffects) ? (value.projectEffects as Effect[]) : [],
    editors: isRecord(value.editors) ? (value.editors as Record<string, EditorState>) : {},
  };
}

function uniqueGifFileName(name: string, usedNames: Set<string>) {
  const base = safeFileBase(name);
  let fileName = `${base}.gif`;
  let index = 2;

  while (usedNames.has(fileName.toLowerCase())) {
    fileName = `${base}-${index}.gif`;
    index += 1;
  }

  usedNames.add(fileName.toLowerCase());
  return fileName;
}

function projectScopedEffects(asset: ProjectAsset, effects: Effect[]) {
  return asset.ignoreProjectEffects ? [] : effects;
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

function Icon({ name }: { name: "sparkles" | "plus" | "save" | "undo" | "redo" | "reset" | "close" | "trash" | "eye" | "eye-off" | "layers" | "layers-off" | "play" | "pause" | "first" | "prev" | "next" | "duplicate" | "up" | "down" | "power" | "power-off" | "moon" | "sun" }) {
  const paths = {
    sparkles: <path d="M12 2 13.6 6.4 18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Zm7 10 1 2.8L23 16l-3 1.2L19 20l-1-2.8L15 16l3-1.2 1-2.8ZM5 13l1.1 3L9 17.1 6.1 18 5 21l-1.1-3L1 17.1 3.9 16 5 13Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    save: <path d="M5 3h11l3 3v15H5V3Zm2 2v4h8V5H7Zm0 8v6h10v-6H7Zm2 1h6v4H9v-4Z" />,
    undo: <path d="M9 7H4v5M5 8c2.1-2.7 5.8-4 9.2-2.8A7 7 0 1 1 9 18" />,
    redo: <path d="M15 7h5v5m-1-4c-2.1-2.7-5.8-4-9.2-2.8A7 7 0 1 0 15 18" />,
    reset: <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-4.9 6H5a7 7 0 1 0 7-8Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    trash: <path d="M4 7h16M10 11v6m4-6v6M9 4h6l1 2H8l1-2Zm-2 3h10l-1 13H8L7 7Z" />,
    eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />,
    "eye-off": <path d="m4 4 16 16M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a18.3 18.3 0 0 1-4.1 4.6m-3 1.6A9.7 9.7 0 0 1 12 18c-6.5 0-10-6-10-6a18 18 0 0 1 5.2-5.2M9.9 9.8a3.5 3.5 0 0 0 4.3 4.3" />,
    layers: <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Zm-9 9 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />,
    "layers-off": <path d="m4 4 16 16M12 3l9 4.5-2.3 1.1M3 7.5 12 12l1.7-.9M3 12l9 4.5 3.1-1.5M3 16.5 12 21l5.2-2.6" />,
    play: <path d="M8 5v14l11-7L8 5Z" />,
    pause: <path d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z" />,
    first: <path d="M6 5h2v14H6V5Zm4 7 8-7v14l-8-7Z" />,
    prev: <path d="M15 6 7 12l8 6V6Z" />,
    next: <path d="m9 6 8 6-8 6V6Z" />,
    duplicate: <path d="M9 9h10v10H9V9Zm-4-4h10v2H7v8H5V5Z" />,
    up: <path d="m12 6-5 6h10l-5-6Zm0 12V8" />,
    down: <path d="m12 18 5-6H7l5 6Zm0-12v10" />,
    power: <path d="M12 3v7m5.7-4.7a7 7 0 1 1-11.4 0" />,
    "power-off": <path d="M12 3v7m-7.3-4.7a7 7 0 1 0 11.4 0M4 4l16 16" />,
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z" />,
    sun: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7 5.7 1.4 1.4M4.9 4.9l1.4 1.4m11.4-1.4-1.4 1.4M6.3 17.7l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
  } as const;

  return (
    <svg className="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function getTimingEffect(effects: Effect[]) {
  return effects.find((effect): effect is TimingEffect => effect.kind === "timing" && effect.enabled) ?? { id: "timing-default", kind: "timing", enabled: true, trimStart: 0, trimEnd: 0, reverse: false, speed: 1, loopCount: 0 };
}

function getTransformEffect(effects: Effect[]) {
  return effects.find((effect): effect is TransformEffect => effect.kind === "transform" && effect.enabled) ?? { id: "transform-default", kind: "transform", enabled: true, flipH: false, flipV: false, rotate: 0, scale: 1, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 };
}

function getCanvasStyleEffect(effects: Effect[]) {
  return [...effects].reverse().find((effect): effect is CanvasStyleEffect => effect.kind === "canvas-style" && effect.enabled) ?? null;
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
  if (kind === "canvas-style") return { id, kind, enabled: true, backgroundColor: "#101318", transparentBackground: true, cornerRadius: 0, borderWidth: 0, borderColor: "#f4b860" };
  if (kind === "preset") return { id, kind, enabled: true, preset: "grayscale" };
  if (kind === "adjust") return { id, kind, enabled: true, brightness: 0, contrast: 0, saturation: 0, lightness: 0, hue: 0 };
  if (kind === "tint") return { id, kind, enabled: true, color: "#f4b860", amount: 35 };
  if (kind === "color-replace") return { id, kind, enabled: true, from: "#00ff00", to: "#f4b860", tolerance: 22, softness: 20 };
  if (kind === "blur") return { id, kind, enabled: true, radius: 2 };
  if (kind === "vignette") return { id, kind, enabled: true, amount: 45 };
  if (kind === "noise") return { id, kind, enabled: true, amount: 12 };
  if (kind === "posterize") return { id, kind, enabled: true, levels: 5 };
  if (kind === "solarize") return { id, kind, enabled: true, threshold: 50 };
  if (kind === "emboss") return { id, kind, enabled: true, strength: 70 };
  if (kind === "oil-paint") return { id, kind, enabled: true, radius: 2 };
  if (kind === "distortion") return { id, kind, enabled: true, mode: "wave", amount: 35, radius: 75, frequency: 3 };
  return { id, kind, enabled: true, color: "#00ff00", tolerance: 22, softness: 10 };
}

function effectName(effect: Effect) {
  if (effect.kind === "background-removal") return "Background removal";
  if (effect.kind === "color-replace") return "Color replacement";
  if (effect.kind === "canvas-style") return "Canvas style";
  if (effect.kind === "oil-paint") return "Oil paint";
  return effect.kind.replaceAll("-", " ");
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

  if (preset === "gotham") return [r * 0.75, g * 0.9 + 12, b * 1.15 + 18];
  if (preset === "lomo") return [r * 1.18 + 10, g * 1.05, b * 0.82];
  if (preset === "toaster") return [r * 1.25 + 22, g * 0.95 + 12, b * 0.72];
  if (preset === "polaroid") return [r * 1.08 + 12, g * 1.03 + 8, b * 0.92 + 18];
  if (preset === "nashville") return [r * 1.08 + 18, g * 0.98 + 10, b * 1.05 + 28];

  return [255 - r, 255 - g, 255 - b];
}

function posterizeChannel(value: number, levels: number) {
  const safeLevels = Math.max(2, levels);
  return Math.round(Math.round((value / 255) * (safeLevels - 1)) * (255 / (safeLevels - 1)));
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

    if (effect.kind === "posterize") {
      r = posterizeChannel(r, effect.levels);
      g = posterizeChannel(g, effect.levels);
      b = posterizeChannel(b, effect.levels);
    }

    if (effect.kind === "solarize") {
      const threshold = effect.threshold * 2.55;
      if (r > threshold) r = 255 - r;
      if (g > threshold) g = 255 - g;
      if (b > threshold) b = 255 - b;
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

function applyEmbossEffect(imageData: ImageData, strength: number) {
  const next = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const source = imageData.data;
  const target = next.data;
  const amount = strength / 100;

  for (let y = 1; y < imageData.height - 1; y += 1) {
    for (let x = 1; x < imageData.width - 1; x += 1) {
      const i = (y * imageData.width + x) * 4;
      const before = ((y - 1) * imageData.width + (x - 1)) * 4;
      const after = ((y + 1) * imageData.width + (x + 1)) * 4;
      target[i] = clamp(128 + (source[after] - source[before]) * amount);
      target[i + 1] = clamp(128 + (source[after + 1] - source[before + 1]) * amount);
      target[i + 2] = clamp(128 + (source[after + 2] - source[before + 2]) * amount);
    }
  }

  return next;
}

function applyOilPaintEffect(imageData: ImageData, radius: number) {
  const next = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const source = imageData.data;
  const target = next.data;
  const safeRadius = Math.max(1, Math.min(4, Math.round(radius)));

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let oy = -safeRadius; oy <= safeRadius; oy += 1) {
        for (let ox = -safeRadius; ox <= safeRadius; ox += 1) {
          const sx = Math.max(0, Math.min(imageData.width - 1, x + ox));
          const sy = Math.max(0, Math.min(imageData.height - 1, y + oy));
          const si = (sy * imageData.width + sx) * 4;
          r += source[si];
          g += source[si + 1];
          b += source[si + 2];
          a += source[si + 3];
          count += 1;
        }
      }

      const i = (y * imageData.width + x) * 4;
      target[i] = r / count;
      target[i + 1] = g / count;
      target[i + 2] = b / count;
      target[i + 3] = a / count;
    }
  }

  return next;
}

function applyDistortionEffect(imageData: ImageData, effect: DistortionEffect) {
  const next = new ImageData(imageData.width, imageData.height);
  const source = imageData.data;
  const target = next.data;
  const centerX = imageData.width / 2;
  const centerY = imageData.height / 2;
  const maxRadius = Math.hypot(centerX, centerY) * (effect.radius / 100);
  const amount = effect.amount / 100;

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      let sx = x;
      let sy = y;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy);

      if (effect.mode === "wave") {
        sx = x + Math.sin((y / Math.max(1, imageData.height)) * effect.frequency * Math.PI * 2) * amount * 24;
      } else if (distance < maxRadius && maxRadius > 0) {
        const falloff = 1 - distance / maxRadius;
        if (effect.mode === "swirl") {
          const angle = Math.atan2(dy, dx) + falloff * amount * Math.PI * 2;
          sx = centerX + Math.cos(angle) * distance;
          sy = centerY + Math.sin(angle) * distance;
        } else {
          const pull = 1 - falloff * amount;
          sx = centerX + dx * pull;
          sy = centerY + dy * pull;
        }
      }

      const clampedX = Math.max(0, Math.min(imageData.width - 1, Math.round(sx)));
      const clampedY = Math.max(0, Math.min(imageData.height - 1, Math.round(sy)));
      const si = (clampedY * imageData.width + clampedX) * 4;
      const ti = (y * imageData.width + x) * 4;
      target[ti] = source[si];
      target[ti + 1] = source[si + 1];
      target[ti + 2] = source[si + 2];
      target[ti + 3] = source[si + 3];
    }
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
    if (effect.kind === "emboss") {
      ctx.putImageData(applyEmbossEffect(ctx.getImageData(0, 0, canvas.width, canvas.height), effect.strength), 0, 0);
      return;
    }

    if (effect.kind === "oil-paint") {
      ctx.putImageData(applyOilPaintEffect(ctx.getImageData(0, 0, canvas.width, canvas.height), effect.radius), 0, 0);
      return;
    }

    if (effect.kind === "distortion") {
      ctx.putImageData(applyDistortionEffect(ctx.getImageData(0, 0, canvas.width, canvas.height), effect), 0, 0);
      return;
    }

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

function roundedRectPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(safeRadius, 0);
  ctx.lineTo(width - safeRadius, 0);
  ctx.quadraticCurveTo(width, 0, width, safeRadius);
  ctx.lineTo(width, height - safeRadius);
  ctx.quadraticCurveTo(width, height, width - safeRadius, height);
  ctx.lineTo(safeRadius, height);
  ctx.quadraticCurveTo(0, height, 0, height - safeRadius);
  ctx.lineTo(0, safeRadius);
  ctx.quadraticCurveTo(0, 0, safeRadius, 0);
  ctx.closePath();
}

function renderSourceFrame(target: HTMLCanvasElement, frame: SourceFrame, project: ProjectAsset) {
  target.width = project.width;
  target.height = project.height;
  target.getContext("2d")?.putImageData(frame.imageData, 0, 0);
}

function renderFrame(target: HTMLCanvasElement, frame: SourceFrame, project: ProjectAsset, editor: EditorState, projectEffects: Effect[] = []) {
  const transform = getTransformEffect(editor.effects);
  const effects = [...projectEffects, ...editor.effects, ...(editor.frameEffects[String(frame.index)] ?? [])];
  const canvasStyle = getCanvasStyleEffect(effects);
  const source = document.createElement("canvas");
  source.width = project.width;
  source.height = project.height;
  source.getContext("2d")?.putImageData(applyEffectStack(frame.imageData, effects.filter((effect) => !["timing", "transform", "canvas-style"].includes(effect.kind))), 0, 0);

  const { width, height } = getOutputSize(project, editor);
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  if (!ctx) return;

  const content = document.createElement("canvas");
  content.width = width;
  content.height = height;
  const contentCtx = content.getContext("2d");
  if (!contentCtx) return;

  contentCtx.clearRect(0, 0, width, height);
  contentCtx.save();
  contentCtx.translate(width / 2, height / 2);
  contentCtx.rotate((transform.rotate * Math.PI) / 180);
  contentCtx.scale(transform.flipH ? -transform.scale : transform.scale, transform.flipV ? -transform.scale : transform.scale);
  const sx = project.width * (transform.cropLeft / 100);
  const sy = project.height * (transform.cropTop / 100);
  const sw = project.width * (transform.cropWidth / 100);
  const sh = project.height * (transform.cropHeight / 100);
  contentCtx.drawImage(source, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  contentCtx.restore();

  ctx.clearRect(0, 0, width, height);
  if (canvasStyle && !canvasStyle.transparentBackground) {
    ctx.fillStyle = canvasStyle.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.save();
  if (canvasStyle?.cornerRadius) {
    roundedRectPath(ctx, width, height, canvasStyle.cornerRadius);
    ctx.clip();
  }
  ctx.drawImage(content, 0, 0);
  ctx.restore();

  if (canvasStyle && canvasStyle.borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = canvasStyle.borderColor;
    ctx.lineWidth = canvasStyle.borderWidth;
    roundedRectPath(ctx, width, height, canvasStyle.cornerRadius);
    ctx.stroke();
    ctx.restore();
  }
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

function canvasThumbnail(source: HTMLCanvasElement, width: number, height: number) {
  const thumb = document.createElement("canvas");
  thumb.width = width;
  thumb.height = height;
  const ctx = thumb.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");

  const scale = Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return thumb.toDataURL("image/png");
}

function renderAssetThumbnail(frame: SourceFrame, project: ProjectAsset, editor: EditorState, projectEffects: Effect[] = []) {
  const rendered = document.createElement("canvas");
  renderFrame(rendered, frame, project, editor, projectEffects);

  const thumb = document.createElement("canvas");
  thumb.width = 52;
  thumb.height = 52;
  const ctx = thumb.getContext("2d");
  if (!ctx) return frame.thumbnail;

  const scale = Math.min(thumb.width / rendered.width, thumb.height / rendered.height);
  const width = rendered.width * scale;
  const height = rendered.height * scale;
  ctx.drawImage(rendered, (thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
  return thumb.toDataURL("image/png");
}

function getPlayableFrames(project: ProjectAsset | null, editor: EditorState) {
  if (!project) return [];
  const timing = getTimingEffect(editor.effects);
  const frameByIndex = new Map(project.frames.map((frame) => [frame.index, frame]));
  const orderedFrames = (editor.frameOrder?.length ? editor.frameOrder : project.frames.map((frame) => frame.index))
    .map((index) => frameByIndex.get(index))
    .filter((frame): frame is SourceFrame => Boolean(frame));
  const end = timing.trimEnd || orderedFrames.length - 1;
  const start = Math.min(timing.trimStart, end);
  const safeEnd = Math.max(timing.trimStart, end);
  const trimmed = orderedFrames.slice(start, safeEnd + 1);
  return timing.reverse ? [...trimmed].reverse() : trimmed;
}

function rangeLabel(project: ProjectAsset | null, editor: EditorState) {
  if (!project) return "0 frames";
  const frames = getPlayableFrames(project, editor);
  const timing = getTimingEffect(editor.effects);
  const duration = frames.reduce((sum, frame) => sum + frame.delay / timing.speed, 0);
  return `${frames.length} frames · ${(duration / 1000).toFixed(2)}s`;
}

function renderGifBlob(
  asset: ProjectAsset,
  editor: EditorState,
  projectEffects: Effect[],
  settings: ExportSettings,
  onProgress?: (progress: number) => void,
) {
  const playable = getPlayableFrames(asset, editor);
  if (playable.length === 0) return Promise.reject(new Error(`No playable frames for ${asset.name}.`));

  const timing = getTimingEffect(editor.effects);
  const { width, height } = getOutputSize(asset, editor);
  const gif = new GIF({
    workers: settings.workers,
    quality: settings.quality,
    width,
    height,
    workerScript,
    repeat: timing.loopCount,
    ...(settings.optimizeTransparency ? { background: "#ff00ff", transparent: transparencyKeyNumber } : {}),
    dither: settings.dither,
  });
  const canvas = document.createElement("canvas");

  playable.forEach((frame) => {
    renderFrame(canvas, frame, asset, editor, projectEffects);
    if (settings.optimizeTransparency) prepareGifTransparency(canvas);
    gif.addFrame(canvas, { copy: true, delay: Math.max(20, frame.delay / timing.speed) });
  });

  return new Promise<Blob>((resolve, reject) => {
    gif.on("progress", (progress: number) => onProgress?.(progress));
    gif.on("finished", (blob: Blob) => resolve(blob));

    try {
      gif.render();
    } catch (error) {
      reject(error);
    }
  });
}

function getExportStats(asset: ProjectAsset | null, editor: EditorState, outputSize: { width: number; height: number } | null) {
  const frames = getPlayableFrames(asset, editor);
  const timing = getTimingEffect(editor.effects);
  const durationMs = frames.reduce((sum, frame) => sum + frame.delay / timing.speed, 0);
  const averageFps = durationMs > 0 ? frames.length / (durationMs / 1000) : 0;
  const estimatedBytes = outputSize ? Math.max(1024, outputSize.width * outputSize.height * Math.max(1, frames.length) * 0.08) : 0;
  return { durationMs, averageFps, estimatedBytes };
}

function scheduleIdleWork(callback: () => void, timeout = 1000) {
  if ("requestIdleCallback" in window && "cancelIdleCallback" in window) {
    const requestIdle = window.requestIdleCallback as (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
    const cancelIdle = window.cancelIdleCallback as (handle: number) => void;
    const id = requestIdle(callback, { timeout });
    return () => cancelIdle(id);
  }

  const id = globalThis.setTimeout(callback, 80);
  return () => globalThis.clearTimeout(id);
}

function inferImageMimeType(name: string, mimeType: string) {
  if (mimeType.startsWith("image/")) return mimeType;
  const lower = name.toLowerCase();
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".apng") || lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return mimeType || "application/octet-stream";
}

function isSupportedImageFile(file: File) {
  const type = inferImageMimeType(file.name, file.type);
  return ["image/gif", "image/png", "image/webp", "image/avif", "image/jpeg"].includes(type);
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

function decodeGifFramesInWorker(name: string, buffer: ArrayBuffer, onProgress?: (progress: number) => void) {
  return new Promise<{ width: number; height: number; frames: WorkerDecodedFrame[] }>((resolve, reject) => {
    const worker = new Worker(gifDecodeWorkerUrl, { type: "module" });
    const id = crypto.randomUUID();

    worker.onmessage = ({ data }: MessageEvent<{ id: string; type: string; progress?: number; message?: string; width?: number; height?: number; frames?: WorkerDecodedFrame[] }>) => {
      if (data.id !== id) return;
      if (data.type === "progress") {
        onProgress?.(data.progress ?? 0);
        return;
      }
      worker.terminate();
      if (data.type === "error") {
        reject(new Error(data.message || `Failed to decode ${name}.`));
        return;
      }
      resolve({ width: data.width ?? 0, height: data.height ?? 0, frames: data.frames ?? [] });
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error instanceof Error ? event.error : new Error(`Failed to decode ${name}.`));
    };

    worker.postMessage({ id, name, buffer }, [buffer]);
  });
}

async function createSourceFramesFromWorkerFrames(width: number, height: number, frames: WorkerDecodedFrame[], onProgress?: (progress: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const builtFrames: SourceFrame[] = [];
  for (const [index, frame] of frames.entries()) {
    const imageData = new ImageData(new Uint8ClampedArray(frame.data), width, height);
    ctx.putImageData(imageData, 0, 0);
    builtFrames.push({
      index: frame.index,
      imageData,
      delay: frame.delay,
      thumbnail: canvas.toDataURL("image/webp", 0.7),
    });

    if (onProgress && (index === frames.length - 1 || index % 8 === 0)) {
      onProgress((index + 1) / Math.max(1, frames.length));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
  }

  return builtFrames;
}

async function decodeAnimatedImageAsset(name: string, buffer: ArrayBuffer, sourceDataUrl: string, mimeType: string, onProgress?: (progress: number) => void): Promise<ProjectAsset> {
  if (!("ImageDecoder" in window)) throw new Error(`${name} needs a browser with animated ${mimeType.replace("image/", "").toUpperCase()} decoding support.`);

  const decoder = new ImageDecoder({ data: buffer, type: mimeType });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track?.frameCount ?? 1;
  const firstDecoded = await decoder.decode({ frameIndex: 0 });
  const width = firstDecoded.image.displayWidth;
  const height = firstDecoded.image.displayHeight;

  if (width <= 0 || height <= 0 || width > maxGifDimension || height > maxGifDimension || width * height > maxGifPixels) {
    throw new Error(`${name} exceeds the supported image dimensions.`);
  }
  if (frameCount > maxGifFrames) throw new Error(`${name} has too many frames to import.`);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const frames: SourceFrame[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const decoded = frameIndex === 0 ? firstDecoded : await decoder.decode({ frameIndex });
    const videoFrame = decoded.image;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(videoFrame, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const durationMs = Math.max(20, Math.round(Number((videoFrame as VideoFrame & { duration?: number }).duration ?? 100000) / 1000));
    frames.push({
      index: frameIndex,
      imageData,
      delay: durationMs,
      thumbnail: canvas.toDataURL("image/webp", 0.7),
    });
    videoFrame.close();

    if (onProgress && (frameIndex === frameCount - 1 || frameIndex % 4 === 0)) {
      onProgress((frameIndex + 1) / frameCount);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
  }

  decoder.close();
  return { id: crypto.randomUUID(), name: normalizeAssetName(name), width, height, frames, sourceDataUrl, hidden: false, ignoreProjectEffects: false };
}

async function decodeStaticImageAsset(name: string, buffer: ArrayBuffer, sourceDataUrl: string, mimeType: string): Promise<ProjectAsset> {
  const blob = new Blob([buffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;

  if (width <= 0 || height <= 0 || width > maxGifDimension || height > maxGifDimension || width * height > maxGifPixels) {
    throw new Error(`${name} exceeds the supported image dimensions.`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  const thumbnail = canvas.toDataURL("image/webp", 0.7);

  return {
    id: crypto.randomUUID(),
    name: normalizeAssetName(name),
    width,
    height,
    frames: [{ index: 0, imageData, delay: 100, thumbnail }],
    sourceDataUrl,
    hidden: false,
    ignoreProjectEffects: false,
  };
}

async function decodeImageAsset(name: string, buffer: ArrayBuffer, sourceDataUrl: string, mimeType: string, onProgress?: (progress: number) => void): Promise<ProjectAsset> {
  if (buffer.byteLength > maxGifFileBytes) throw new Error(`${name} is too large to import.`);
  if (mimeType === "image/gif") {
    const { width, height, frames: decodedFrames } = await decodeGifFramesInWorker(name, buffer, (progress) => onProgress?.(progress * 0.82));
    if (width <= 0 || height <= 0 || width > maxGifDimension || height > maxGifDimension || width * height > maxGifPixels) {
      throw new Error(`${name} exceeds the supported GIF dimensions.`);
    }
    if (decodedFrames.length > maxGifFrames) throw new Error(`${name} has too many frames to import.`);
    const frames = await createSourceFramesFromWorkerFrames(width, height, decodedFrames, (progress) => onProgress?.(0.82 + progress * 0.18));

    return { id: crypto.randomUUID(), name: normalizeAssetName(name), width, height, frames, sourceDataUrl, hidden: false, ignoreProjectEffects: false };
  }

  if (["image/png", "image/webp", "image/avif"].includes(mimeType)) {
    try {
      return await decodeAnimatedImageAsset(name, buffer, sourceDataUrl, mimeType, onProgress);
    } catch {
      return await decodeStaticImageAsset(name, buffer, sourceDataUrl, mimeType);
    }
  }

  if (mimeType === "image/jpeg") return await decodeStaticImageAsset(name, buffer, sourceDataUrl, mimeType);

  throw new Error(`${name} is not a supported image format.`);
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
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportFileSize, setExportFileSize] = useState<number | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [isUploadingToGiphy, setIsUploadingToGiphy] = useState(false);
  const [giphyTags, setGiphyTags] = useState("");
  const [giphyUploadResult, setGiphyUploadResult] = useState<GiphyUploadResult | null>(null);
  const [isBeforePreview, setIsBeforePreview] = useState(false);
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
  const [isMediaBinCollapsed, setIsMediaBinCollapsed] = useState(false);
  const [isEffectsPanelCollapsed, setIsEffectsPanelCollapsed] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerPan, setViewerPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const exportPreviewRef = useRef<HTMLCanvasElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ pointer: PanPoint; pan: PanPoint } | null>(null);
  const exportCancelRequestedRef = useRef(false);
  const lastHistorySnapshotRef = useRef(0);
  const activeAsset = useMemo(() => project?.assets.find((asset) => asset.id === project.activeAssetId) ?? null, [project]);
  const projectEffects = project?.projectEffects ?? [];
  const editor = useMemo(() => {
    if (!project || !activeAsset) return initialEditor;
    return project.editors[activeAsset.id] ?? createDefaultEditor();
  }, [activeAsset, project]);
  const playableFrames = useMemo(() => getPlayableFrames(activeAsset, editor), [activeAsset, editor]);
  const outputSize = useMemo(() => (activeAsset ? getOutputSize(activeAsset, editor) : null), [activeAsset, editor]);
  const viewerOutputSize = isBeforePreview && activeAsset ? { width: activeAsset.width, height: activeAsset.height } : outputSize;
  const selectedFrame = playableFrames[Math.min(currentFrame, Math.max(0, playableFrames.length - 1))];
  const deferredEditor = useDeferredValue(editor);
  const deferredProject = useDeferredValue(project);
  const deferredProjectEffects = useDeferredValue(projectEffects);
  const deferredPlayableFrames = useDeferredValue(playableFrames);
  const activeFrameKey = selectedFrame ? String(selectedFrame.index) : "";
  const activeEffects = effectScope === "project"
    ? projectEffects
    : effectScope === "frame" && activeFrameKey
      ? editor.frameEffects[activeFrameKey] ?? []
      : editor.effects;
  const timing = getTimingEffect(editor.effects);
  const canSavePreset = activeEffects.length > 0;
  const exportBaseName = safeFileBase(exportSettings.fileName, defaultExportSettings.fileName);
  const exportStats = useMemo(() => getExportStats(activeAsset, editor, outputSize), [activeAsset, editor, outputSize]);
  const isAnyModalOpen = isExportModalOpen || isIconModalOpen;
  const isDragDropEnabled = !isAnyModalOpen;
  const visibleAssetCount = project?.assets.filter((asset) => !asset.hidden).length ?? 0;
  const projectWideEffectsCount = projectEffects.length;
  const importProgressValue = importProgress ? Math.min(1, importProgress.overallProgress) : null;
  const visibleAssets = project?.assets.filter((asset) => !asset.hidden) ?? [];
  const hiddenAssets = project?.assets.filter((asset) => asset.hidden) ?? [];
  const workspaceClassName = [
    "workspace",
    isMediaBinCollapsed ? "media-collapsed" : "",
    isEffectsPanelCollapsed ? "effects-collapsed" : "",
  ].filter(Boolean).join(" ");
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
      fileName: safeFileBase(activeAsset.name, defaultExportSettings.fileName),
    }));
    setGiphyTags((value) => value || safeFileBase(activeAsset.name, defaultExportSettings.fileName).replace(/\s+/g, ", "));
    resetViewer();
  }, [activeAsset?.id]);

  useEffect(() => {
    if (!project || !activeAsset) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(autosaveKey, JSON.stringify(editor));
    }, 500);
    return () => window.clearTimeout(timer);
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
    const frameId = window.requestAnimationFrame(() => {
      if (!previewRef.current) return;
      if (isBeforePreview) {
        renderSourceFrame(previewRef.current, selectedFrame, activeAsset);
        return;
      }
      renderFrame(previewRef.current, selectedFrame, activeAsset, editor, projectScopedEffects(activeAsset, projectEffects));
      setLiveThumbnails((current) => ({ ...current, [selectedFrame.index]: canvasThumbnail(previewRef.current!, 96, 72) }));
      setLiveAssetThumbnails((current) => ({ ...current, [activeAsset.id]: canvasThumbnail(previewRef.current!, 52, 52) }));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeAsset, selectedFrame, editor, projectEffects, isBeforePreview]);

  useEffect(() => {
    if (!isExportModalOpen || !activeAsset || !selectedFrame || !exportPreviewRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      if (exportPreviewRef.current) renderFrame(exportPreviewRef.current, selectedFrame, activeAsset, editor, projectScopedEffects(activeAsset, projectEffects));
    });
    return () => window.cancelAnimationFrame(frameId);
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
    if (!viewerOutputSize || !monitorRef.current) return;

    const updateFitScale = () => {
      const rect = monitorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const fit = Math.min(1, (rect.width - 40) / viewerOutputSize.width, (rect.height - 40) / viewerOutputSize.height);
      setFitScale(Math.max(0.05, fit));
    };

    updateFitScale();
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(monitorRef.current);
    return () => observer.disconnect();
  }, [viewerOutputSize]);

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
    if (!activeAsset || deferredPlayableFrames.length === 0) {
      setLiveThumbnails({});
      return;
    }

    if (isPlaying || exportProgress !== null) return;

    let cancelled = false;
    const cancelers: Array<() => void> = [];
    const startIndex = Math.max(0, currentFrame - 12);
    const framesToRender = deferredPlayableFrames.slice(startIndex, Math.min(deferredPlayableFrames.length, currentFrame + 20));
    let index = 0;

    const renderNext = () => {
      const cancel = scheduleIdleWork(() => {
        if (cancelled) return;
        const frame = framesToRender[index];
        if (!frame) return;

        const thumbnail = renderFrameThumbnail(frame, activeAsset, deferredEditor, projectScopedEffects(activeAsset, deferredProjectEffects));
        setLiveThumbnails((current) => ({ ...current, [frame.index]: thumbnail }));
        index += 1;
        renderNext();
      }, 1500);
      cancelers.push(cancel);
    };

    const timer = window.setTimeout(() => {
      renderNext();
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelers.forEach((cancel) => cancel());
    };
  }, [activeAsset, currentFrame, deferredEditor, deferredPlayableFrames, deferredProjectEffects, exportProgress, isPlaying]);

  useEffect(() => {
    if (!deferredProject || deferredProject.assets.length === 0) {
      setLiveAssetThumbnails({});
      return;
    }

    if (isPlaying || exportProgress !== null) return;

    let cancelled = false;
    const cancelers: Array<() => void> = [];
    let index = 0;

    const renderNext = () => {
      const cancel = scheduleIdleWork(() => {
        if (cancelled) return;
        const asset = deferredProject.assets[index];
        if (!asset) return;

        const firstFrame = asset.frames[0];
        if (firstFrame) {
          const thumbnail = renderAssetThumbnail(firstFrame, asset, deferredProject.editors[asset.id] ?? createDefaultEditor(), projectScopedEffects(asset, deferredProject.projectEffects));
          setLiveAssetThumbnails((current) => ({ ...current, [asset.id]: thumbnail }));
        }

        index += 1;
        renderNext();
      }, 2000);
      cancelers.push(cancel);
    };

    const timer = window.setTimeout(renderNext, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelers.forEach((cancel) => cancel());
    };
  }, [deferredProject, exportProgress, isPlaying]);

  function updateEditor(next: Partial<EditorState>) {
    if (!project || !activeAsset) return;
    const now = performance.now();
    if (now - lastHistorySnapshotRef.current > 300) {
      lastHistorySnapshotRef.current = now;
      setHistory((current) => ({ past: [...current.past, editor].slice(-50), future: [] }));
    }
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

  async function appendMediaFiles(files: File[]) {
    const imageFiles = files.filter(isSupportedImageFile);
    if (imageFiles.length === 0) {
      setStatus("Drop or import GIF, APNG, WebP, AVIF, PNG, or JPEG files.");
      return;
    }

    const oversized = imageFiles.find((file) => file.size > maxGifFileBytes);
    if (oversized) {
      setStatus(`${oversized.name} is too large to import.`);
      return;
    }

    setStatus(`Decoding ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}...`);
    setIsPlaying(false);
    setDownloadUrl(null);
    setImportProgress({
      completedFiles: 0,
      totalFiles: imageFiles.length,
      currentFileName: imageFiles[0]?.name ?? "",
      currentFileProgress: 0,
      overallProgress: 0,
    });

    try {
      const fileProgress = imageFiles.map(() => 0);
      const decodedAssets = new Array<ProjectAsset>(imageFiles.length);
      const concurrency = Math.min(imageFiles.length, Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))));
      let nextFileIndex = 0;

      const updateProgress = (fileIndex: number, currentFileProgress: number, currentFileName: string) => {
        fileProgress[fileIndex] = currentFileProgress;
        setImportProgress({
          completedFiles: fileProgress.filter((progress) => progress >= 1).length,
          totalFiles: imageFiles.length,
          currentFileName,
          currentFileProgress,
          overallProgress: fileProgress.reduce((sum, progress) => sum + progress, 0) / imageFiles.length,
        });
      };

      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (true) {
          const index = nextFileIndex;
          nextFileIndex += 1;
          if (index >= imageFiles.length) return;

          const file = imageFiles[index];
          const mimeType = inferImageMimeType(file.name, file.type);
          updateProgress(index, 0, file.name);
          const sourceDataUrl = await fileToDataUrl(file);
          const buffer = await file.arrayBuffer();
          decodedAssets[index] = await decodeImageAsset(file.name, buffer, sourceDataUrl, mimeType, (currentFileProgress) => {
            updateProgress(index, currentFileProgress, file.name);
          });
          updateProgress(index, 1, file.name);
        }
      }));

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
      setStatus(`Added ${decodedAssets.length} image${decodedAssets.length === 1 ? "" : "s"} to the project.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to decode images.");
    } finally {
      setImportProgress(null);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    await appendMediaFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!isDragDropEnabled) return;
    if (event.dataTransfer.types.includes("application/x-frameforge-effect") || event.dataTransfer.types.includes("application/x-ogs-asset")) return;
    await appendMediaFiles(Array.from(event.dataTransfer.files));
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

      await appendMediaFiles([file]);
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

    if (file.size > maxProjectFileBytes) {
      setStatus("Project file is too large to load.");
      event.target.value = "";
      return;
    }

    try {
      const saved = validateSavedProject(JSON.parse(await file.text()));
      setStatus(`Loading project ${saved.name}...`);
      const assets: ProjectAsset[] = [];
      for (const asset of saved.assets) {
        const buffer = await dataUrlToArrayBuffer(asset.sourceDataUrl);
        const mimeType = asset.sourceDataUrl.match(/^data:([^;,]+)/)?.[1] || inferImageMimeType(asset.name, "");
        const decoded = await decodeImageAsset(asset.name, buffer, asset.sourceDataUrl, mimeType);
        assets.push({ ...decoded, id: asset.id, hidden: asset.hidden ?? false, ignoreProjectEffects: asset.ignoreProjectEffects ?? false });
      }

      const editors = Object.fromEntries(
        assets.map((asset) => [asset.id, saved.editors[asset.id] ?? createDefaultEditor()]),
      );

      setProject({
        name: saved.name,
        activeAssetId: assets.some((asset) => asset.id === saved.activeAssetId) ? saved.activeAssetId : assets[0]?.id || "",
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
        assets: project.assets.map((asset) => ({ id: asset.id, name: asset.name, sourceDataUrl: asset.sourceDataUrl, hidden: asset.hidden, ignoreProjectEffects: asset.ignoreProjectEffects })),
        projectEffects: project.projectEffects,
        editors: project.editors,
      };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeProjectFileBase(project.name)}.ogsp.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renameAsset(assetId: string, name: string) {
    if (!project) return;
    setProject({
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, name: normalizeAssetName(name) } : asset)),
    });
  }

  function updateAsset(assetId: string, next: Partial<ProjectAsset>) {
    if (!project) return;
    setProject({
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, ...next } : asset)),
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

  function updateActiveEditor(nextEditor: EditorState) {
    if (!project || !activeAsset) return;
    lastHistorySnapshotRef.current = performance.now();
    setHistory((value) => ({ past: [...value.past, editor].slice(-50), future: [] }));
    setProject({
      ...project,
      editors: {
        ...project.editors,
        [activeAsset.id]: nextEditor,
      },
    });
    setDownloadUrl(null);
    setExportFileSize(null);
  }

  function duplicateCurrentFrame() {
    if (!activeAsset || !selectedFrame) return;
    const baseOrder = editor.frameOrder?.length ? editor.frameOrder : activeAsset.frames.map((frame) => frame.index);
    const insertAt = Math.min(currentFrame + 1, baseOrder.length);
    const nextOrder = [...baseOrder.slice(0, insertAt), selectedFrame.index, ...baseOrder.slice(insertAt)];
    updateActiveEditor({ ...editor, frameOrder: nextOrder });
    setCurrentFrame(insertAt);
    setStatus(`Duplicated frame ${selectedFrame.index + 1}.`);
  }

  function deleteCurrentFrame() {
    if (!activeAsset || !selectedFrame || playableFrames.length <= 1) return;
    const baseOrder = editor.frameOrder?.length ? editor.frameOrder : activeAsset.frames.map((frame) => frame.index);
    let removed = false;
    const nextOrder = baseOrder.filter((frameIndex) => {
      if (!removed && frameIndex === selectedFrame.index) {
        removed = true;
        return false;
      }
      return true;
    });
    updateActiveEditor({ ...editor, frameOrder: nextOrder });
    setCurrentFrame((index) => Math.max(0, Math.min(index, nextOrder.length - 1)));
    setStatus(`Deleted frame ${selectedFrame.index + 1}.`);
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

  async function uploadToGiphy() {
    if (!downloadUrl) return;
    setIsUploadingToGiphy(true);
    setGiphyUploadResult(null);
    setStatus("Uploading GIF to GIPHY...");

    try {
      const blob = await fetch(downloadUrl).then((response) => response.blob());
      const formData = new FormData();
      formData.set("file", new File([blob], `${exportBaseName}.gif`, { type: "image/gif" }));
      if (giphyTags.trim()) formData.set("tags", giphyTags.trim());

      const response = await fetch("/api/giphy/upload", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Failed to upload GIF to GIPHY.");

      const id = typeof payload?.data?.id === "string" ? payload.data.id : null;
      const url = id ? `https://giphy.com/gifs/${id}` : null;
      setGiphyUploadResult({ id, url });
      setStatus(id ? `Uploaded to GIPHY: ${id}` : "Uploaded to GIPHY.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to upload GIF to GIPHY.");
    } finally {
      setIsUploadingToGiphy(false);
    }
  }

  async function exportGif() {
    if (!activeAsset || playableFrames.length === 0) return;
    exportCancelRequestedRef.current = false;
    setIsPlaying(false);
    setExportProgress(0);
    setStatus("Rendering GIF export...");
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setExportFileSize(null);

    try {
      const blob = await renderGifBlob(activeAsset, editor, projectScopedEffects(activeAsset, projectEffects), exportSettings, setExportProgress);
      if (exportCancelRequestedRef.current) {
        setStatus("Export canceled.");
        return;
      }
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setExportFileSize(blob.size);
      setStatus(`Export complete: ${(blob.size / 1024 / 1024).toFixed(2)} MB.`);
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : "Unknown render error."}`);
    } finally {
      setExportProgress(null);
    }
  }

  async function bulkExportGif() {
    if (!project || project.assets.length === 0) return;
    exportCancelRequestedRef.current = false;
    setIsBulkExporting(true);
    setStatus("Starting bulk export...");

    const zip = new JSZip();
    const exportableAssets = project.assets.filter((asset) => !asset.hidden);
    const total = exportableAssets.length;
    if (total === 0) {
      setIsBulkExporting(false);
      setStatus("No visible GIFs to export.");
      return;
    }
    const usedNames = new Set<string>();

    try {
      for (const [index, asset] of exportableAssets.entries()) {
        if (exportCancelRequestedRef.current) throw new Error("Bulk export canceled.");
        setStatus(`Bulk export: ${index + 1}/${total} - ${asset.name}...`);
        const assetEditor = project.editors[asset.id] ?? createDefaultEditor();
        const blob = await renderGifBlob(asset, assetEditor, projectScopedEffects(asset, project.projectEffects), exportSettings, (progress) => {
          setExportProgress((index + progress) / total);
        });
        if (exportCancelRequestedRef.current) throw new Error("Bulk export canceled.");
        zip.file(uniqueGifFileName(asset.name, usedNames), blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
        setExportProgress(metadata.percent / 100);
      });

      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeProjectFileBase(project.name)}-export.zip`;
      link.click();
      URL.revokeObjectURL(url);

      setStatus(`Bulk export complete: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB.`);
    } catch (error) {
      setStatus(`Bulk export failed: ${error instanceof Error ? error.message : "Unknown render error."}`);
    } finally {
      setExportProgress(null);
      setIsBulkExporting(false);
    }
  }

  function cancelExport() {
    exportCancelRequestedRef.current = true;
    setStatus("Cancel requested. Waiting for the current render step to stop...");
  }

  const canEdit = activeAsset !== null;
  const effectScopeLabel = effectScope === "project" ? "project" : effectScope === "frame" ? "frame" : "whole GIF";

  const renderAssetCard = (asset: ProjectAsset) => (
    <div
      className={[asset.id === project?.activeAssetId ? "asset-card active" : "asset-card", asset.hidden ? "hidden" : "", draggedAssetId === asset.id ? "dragging" : ""].filter(Boolean).join(" ")}
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
          if (!project) return;
          setProject({ ...project, activeAssetId: asset.id });
          setCurrentFrame(0);
        }}
      >
        <img className="asset-thumb" src={liveAssetThumbnails[asset.id] ?? asset.frames[0]?.thumbnail} alt="" />
      </button>
      <div className="asset-meta">
        <div className="asset-header">
          <div className="asset-row asset-badges-row">
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
            {asset.hidden && <span className="asset-badge muted">Hidden</span>}
            {asset.ignoreProjectEffects && <span className="asset-badge muted">Local FX</span>}
          </div>
          <div className="asset-card-actions">
            <button className={asset.hidden ? "mini-button active icon-only-button" : "mini-button icon-only-button"} type="button" aria-label={asset.hidden ? `Show ${asset.name}` : `Hide ${asset.name} from bulk export`} title={asset.hidden ? "Show / include in bulk export" : "Hide / exclude from bulk export"} onClick={() => updateAsset(asset.id, { hidden: !asset.hidden })}><Icon name={asset.hidden ? "eye-off" : "eye"} /></button>
            <button className={asset.ignoreProjectEffects ? "mini-button active icon-only-button" : "mini-button icon-only-button"} type="button" aria-label={asset.ignoreProjectEffects ? `Use only local effects for ${asset.name}` : `Apply project effects to ${asset.name}`} title={asset.ignoreProjectEffects ? "Local effects only" : "Use project-wide effects"} onClick={() => updateAsset(asset.id, { ignoreProjectEffects: !asset.ignoreProjectEffects })}><Icon name={asset.ignoreProjectEffects ? "layers-off" : "layers"} /></button>
            <button className="mini-button danger asset-remove icon-only-button" type="button" aria-label={`Remove ${asset.name}`} title="Remove GIF" onClick={() => removeAsset(asset.id)}><Icon name="trash" /></button>
          </div>
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
            if (!project) return;
            setProject({ ...project, activeAssetId: asset.id });
            setCurrentFrame(0);
          }}
        >
          {asset.width} x {asset.height} · {asset.frames.length} frames
        </button>
      </div>
    </div>
  );

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
          <div className="command-group">
            <label className="button quiet">
              Load
              <input ref={projectInputRef} type="file" accept="application/json,.json,.ogsp.json" onChange={handleProjectImport} />
            </label>
            <button className="button quiet icon-only-button" type="button" aria-label="Save project" title="Save" disabled={!project} onClick={saveProjectFile}><Icon name="save" /></button>
            <button className="button quiet icon-only-button" type="button" aria-label="Undo" title="Undo" disabled={history.past.length === 0} onClick={undo}><Icon name="undo" /></button>
            <button className="button quiet icon-only-button" type="button" aria-label="Redo" title="Redo" disabled={history.future.length === 0} onClick={redo}><Icon name="redo" /></button>
            <button className="button quiet icon-only-button" type="button" aria-label="Reset edits" title="Reset" disabled={!canEdit} onClick={resetEdits}><Icon name="reset" /></button>
          </div>
          <div className="command-group utility-links">
            <button className="button export" type="button" disabled={!canEdit} onClick={openExportModal}>
              Export
            </button>
            <button className="button export" type="button" disabled={!project || project.assets.length === 0 || isBulkExporting} onClick={bulkExportGif}>
              {isBulkExporting ? `Exporting ${Math.round((exportProgress ?? 0) * 100)}%` : "Export All"}
            </button>
            <button className="theme-switch" type="button" onClick={() => setThemeMode((value) => (value === "dark" ? "light" : "dark"))} aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`} title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}>
              <span className={themeMode === "dark" ? "theme-chip active" : "theme-chip"}><Icon name="moon" /></span>
              <span className={themeMode === "light" ? "theme-chip active" : "theme-chip"}><Icon name="sun" /></span>
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

      <section className={workspaceClassName}>
        <aside className={isMediaBinCollapsed ? "panel media-bin collapsed" : "panel media-bin"}>
          <div className="panel-head">
            <h2>Media Bin</h2>
            <div className="panel-head-actions">
              {!isMediaBinCollapsed && <label className="mini-button icon-only-button media-add-button" aria-label="Add media" title="Add media"><Icon name="plus" /><input type="file" accept={supportedImageAccept} multiple onChange={handleImport} /></label>}
              {!isMediaBinCollapsed && <button className="mini-button icon-only-button" type="button" aria-label="Open animated icons" title="Animated Icons" onClick={openIconModal}><Icon name="sparkles" /></button>}
              <button className="mini-button panel-collapse-button" type="button" aria-label={isMediaBinCollapsed ? "Open media bin" : "Collapse media bin"} title={isMediaBinCollapsed ? "Open media bin" : "Collapse media bin"} onClick={() => setIsMediaBinCollapsed((value) => !value)}>
                {isMediaBinCollapsed ? "›" : "‹"}
              </button>
            </div>
          </div>
          {!isMediaBinCollapsed && <>
              {project ? (
                <>
                  <div className="asset-list">
                    <section className="asset-group">
                      <div className="asset-group-head">
                        <strong>Visible</strong>
                        <span>{visibleAssets.length}</span>
                      </div>
                      <div className="asset-group-list">
                        {visibleAssets.map(renderAssetCard)}
                      </div>
                    </section>
                    {hiddenAssets.length > 0 && (
                      <section className="asset-group">
                        <div className="asset-group-head">
                          <strong>Hidden</strong>
                          <span>{hiddenAssets.length}</span>
                        </div>
                        <div className="asset-group-list">
                          {hiddenAssets.map(renderAssetCard)}
                        </div>
                      </section>
                    )}
                  </div>
                </>
              ) : (
                <label className="drop-copy">
                  <strong>No source loaded</strong>
                  <span>Import or drop GIF, APNG, WebP, AVIF, PNG, or JPEG files to build a project.</span>
                  <input type="file" accept={supportedImageAccept} multiple onChange={handleImport} />
                </label>
              )}
            </>}
        </aside>

        <section className="monitor-stage">
          <div className="monitor-head">
            <div className="monitor-status-wrap">
              <span>{status}</span>
              {importProgress && (
                <div className="progress-strip" aria-label="Import progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(importProgressValue ? importProgressValue * 100 : 0)}>
                  <div className="progress-strip-fill" style={{ width: `${(importProgressValue ?? 0) * 100}%` }} />
                </div>
              )}
            </div>
            <div className="viewer-controls">
              {exportProgress !== null && <span>{Math.round(exportProgress * 100)}%</span>}
              <button className={isBeforePreview ? "mini-button active" : "mini-button"} type="button" disabled={!canEdit} onClick={() => setIsBeforePreview((value) => !value)}>
                {isBeforePreview ? "Before" : "After"}
              </button>
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
                      style={viewerOutputSize ? { width: `${viewerOutputSize.width * fitScale * viewerZoom}px`, height: `${viewerOutputSize.height * fitScale * viewerZoom}px` } : undefined}
                    />
                  </div>
                ) : null}
              </div>
              <div className="transport">
                <button className="button icon-only-button" type="button" aria-label="Go to first frame" title="First frame" disabled={!canEdit} onClick={() => setCurrentFrame(0)}><Icon name="first" /></button>
                <button className="button primary icon-only-button" type="button" aria-label={isPlaying ? "Pause playback" : "Play preview"} title={isPlaying ? "Pause" : "Play"} disabled={!canEdit} onClick={() => setIsPlaying((value) => !value)}><Icon name={isPlaying ? "pause" : "play"} /></button>
                <button
                  className="button icon-only-button"
                  type="button"
                  aria-label="Previous frame"
                  title="Previous frame"
                  disabled={!canEdit}
                  onClick={() => setCurrentFrame((index) => Math.max(0, index - 1))}
                >
                  <Icon name="prev" />
                </button>
                <button
                  className="button icon-only-button"
                  type="button"
                  aria-label="Next frame"
                  title="Next frame"
                  disabled={!canEdit}
                  onClick={() => setCurrentFrame((index) => Math.min(playableFrames.length - 1, index + 1))}
                >
                  <Icon name="next" />
                </button>
                <button className="button icon-only-button" type="button" aria-label="Duplicate current frame" title="Duplicate frame" disabled={!canEdit || !selectedFrame} onClick={duplicateCurrentFrame}><Icon name="duplicate" /></button>
                <button className="button danger icon-only-button" type="button" aria-label="Delete current frame" title="Delete frame" disabled={!canEdit || playableFrames.length <= 1} onClick={deleteCurrentFrame}><Icon name="trash" /></button>
              </div>
            </>
        </section>

        <aside className={isEffectsPanelCollapsed ? "panel inspector collapsed" : "panel inspector"}>
          <div className="panel-head sticky">
            <h2>Effects</h2>
            <button className="mini-button panel-collapse-button" type="button" aria-label={isEffectsPanelCollapsed ? "Open effects panel" : "Collapse effects panel"} title={isEffectsPanelCollapsed ? "Open effects panel" : "Collapse effects panel"} onClick={() => setIsEffectsPanelCollapsed((value) => !value)}>
              {isEffectsPanelCollapsed ? "‹" : "›"}
            </button>
          </div>

          {!isEffectsPanelCollapsed && <div className={canEdit ? "stack-panel" : "stack-panel disabled"}>
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
                <option value="canvas-style">Canvas style</option>
                <option value="adjust">Color adjust</option>
                <option value="preset">Preset</option>
                <option value="tint">Tint</option>
                <option value="color-replace">Color replacement</option>
                <option value="background-removal">Background removal</option>
                <option value="posterize">Posterize</option>
                <option value="solarize">Solarize</option>
                <option value="blur">Blur</option>
                <option value="vignette">Vignette</option>
                <option value="noise">Noise</option>
                <option value="emboss">Emboss</option>
                <option value="oil-paint">Oil paint</option>
                <option value="distortion">Distortion</option>
              </select>

              <div className="preset-row">
                <input aria-label="Preset name" type="text" placeholder="Preset name" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
                <button className="mini-button icon-only-button" type="button" aria-label="Save current effect preset" title="Save preset" disabled={!canSavePreset} onClick={savePreset}><Icon name="save" /></button>
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
                      <button className="mini-button icon-only-button" type="button" aria-label={`Move ${effectName(effect)} up`} title="Move up" onClick={() => moveEffect(effect.id, -1)} disabled={index === 0}><Icon name="up" /></button>
                      <button className="mini-button icon-only-button" type="button" aria-label={`Move ${effectName(effect)} down`} title="Move down" onClick={() => moveEffect(effect.id, 1)} disabled={index === activeEffects.length - 1}><Icon name="down" /></button>
                      <button className="mini-button icon-only-button" type="button" aria-label={effect.enabled ? `Disable ${effectName(effect)}` : `Enable ${effectName(effect)}`} title={effect.enabled ? "Disable effect" : "Enable effect"} onClick={() => updateEffect(effect.id, { enabled: !effect.enabled })}><Icon name={effect.enabled ? "power" : "power-off"} /></button>
                      <button className="mini-button danger icon-only-button" type="button" aria-label={`Remove ${effectName(effect)}`} title="Remove effect" onClick={() => removeEffect(effect.id)}><Icon name="trash" /></button>
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

                  {effect.kind === "canvas-style" && (
                    <>
                      <ColorField label="Background" value={effect.backgroundColor} onChange={(backgroundColor) => updateEffect(effect.id, { backgroundColor })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "backgroundColor" })} />
                      <label className="check-row"><input type="checkbox" checked={effect.transparentBackground} onChange={(event) => updateEffect(effect.id, { transparentBackground: event.target.checked })} /><span>Transparent background</span></label>
                      <label>Rounded corners {effect.cornerRadius}px<input type="range" min="0" max="128" value={effect.cornerRadius} onChange={(event) => updateEffect(effect.id, { cornerRadius: Number(event.target.value) })} /></label>
                      <label>Border width {effect.borderWidth}px<input type="range" min="0" max="48" value={effect.borderWidth} onChange={(event) => updateEffect(effect.id, { borderWidth: Number(event.target.value) })} /></label>
                      <ColorField label="Border color" value={effect.borderColor} onChange={(borderColor) => updateEffect(effect.id, { borderColor })} onPickPreview={() => startPreviewColorPick({ effectId: effect.id, field: "borderColor" })} />
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
                        <option value="gotham">Gotham</option>
                        <option value="lomo">Lomo</option>
                        <option value="toaster">Toaster</option>
                        <option value="polaroid">Polaroid</option>
                        <option value="nashville">Nashville</option>
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
                  {effect.kind === "posterize" && <label>Levels {effect.levels}<input type="range" min="2" max="16" value={effect.levels} onChange={(event) => updateEffect(effect.id, { levels: Number(event.target.value) })} /></label>}
                  {effect.kind === "solarize" && <label>Threshold {effect.threshold}%<input type="range" min="0" max="100" value={effect.threshold} onChange={(event) => updateEffect(effect.id, { threshold: Number(event.target.value) })} /></label>}
                  {effect.kind === "emboss" && <label>Strength {effect.strength}%<input type="range" min="0" max="160" value={effect.strength} onChange={(event) => updateEffect(effect.id, { strength: Number(event.target.value) })} /></label>}
                  {effect.kind === "oil-paint" && <label>Radius {effect.radius}px<input type="range" min="1" max="4" value={effect.radius} onChange={(event) => updateEffect(effect.id, { radius: Number(event.target.value) })} /></label>}
                  {effect.kind === "distortion" && (
                    <>
                      <label>Mode<select value={effect.mode} onChange={(event) => updateEffect(effect.id, { mode: event.target.value as DistortionEffect["mode"] })}><option value="wave">Wave</option><option value="swirl">Swirl</option><option value="implode">Implode</option></select></label>
                      <label>Amount {effect.amount}%<input type="range" min="0" max="100" value={effect.amount} onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value) })} /></label>
                      <label>Radius {effect.radius}%<input type="range" min="10" max="100" value={effect.radius} onChange={(event) => updateEffect(effect.id, { radius: Number(event.target.value) })} /></label>
                      <label>Frequency {effect.frequency}<input type="range" min="1" max="12" value={effect.frequency} onChange={(event) => updateEffect(effect.id, { frequency: Number(event.target.value) })} /></label>
                    </>
                  )}
                </section>
              ))}
            </div>
          </div>}
        </aside>
      </section>

      <section className={isTimelineCollapsed ? "timeline collapsed" : "timeline"}>
        <div className="timeline-head">
          <strong>Timeline</strong>
          <div className="viewer-controls">
            <span>{activeAsset ? `Frame ${Math.min(currentFrame + 1, playableFrames.length)} / ${playableFrames.length}` : "Waiting for media"}</span>
            <button className="mini-button panel-collapse-button" type="button" aria-label={isTimelineCollapsed ? "Open timeline" : "Collapse timeline"} title={isTimelineCollapsed ? "Open timeline" : "Collapse timeline"} onClick={() => setIsTimelineCollapsed((value) => !value)}>
              {isTimelineCollapsed ? "⌃" : "⌄"}
            </button>
          </div>
        </div>
        {!isTimelineCollapsed && <>
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
          </>}
      </section>

      <footer className="project-status-bar">
        <span>{status}</span>
        <strong>{project ? `${project.name} · ${visibleAssetCount}/${project.assets.length} visible GIFs` : "No project loaded"}</strong>
        <span>{activeAsset ? `${rangeLabel(activeAsset, editor)} · ${outputSize ? `${outputSize.width} x ${outputSize.height}` : "-"}` : "Waiting for media"}</span>
        <span>{importProgress ? `Importing ${importProgress.currentFileName} · ${Math.round((importProgressValue ?? 0) * 100)}%` : projectWideEffectsCount === 0 ? "No project-wide effects" : `${projectWideEffectsCount} project-wide effect${projectWideEffectsCount === 1 ? "" : "s"}`}</span>
      </footer>

      {isExportModalOpen && (
        <div className="modal-backdrop" onClick={closeExportModal}>
          <section className="modal export-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Export GIF</h2>
                <p className="modal-copy">Choose file name, quality, and optimization before rendering.</p>
              </div>
              <button className="mini-button icon-only-button" type="button" aria-label="Close export modal" title="Close" onClick={closeExportModal} disabled={exportProgress !== null}><Icon name="close" /></button>
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
                Palette quality {exportSettings.quality}
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
              <label>
                GIPHY tags
                <input type="text" value={giphyTags} placeholder="reaction, ui, gif" onChange={(event) => setGiphyTags(event.target.value)} />
              </label>
            </div>

            <div className="export-summary">
              <span>Output</span>
              <strong>{outputSize ? `${outputSize.width} x ${outputSize.height}` : "-"}</strong>
              <span>Frames</span>
              <strong>{playableFrames.length}</strong>
              <span>Duration</span>
              <strong>{(exportStats.durationMs / 1000).toFixed(2)}s</strong>
              <span>Average FPS</span>
              <strong>{exportStats.averageFps.toFixed(1)}</strong>
              <span>Loop</span>
              <strong>{timing.loopCount === 0 ? "Forever" : `${timing.loopCount}x`}</strong>
              <span>Estimated file</span>
              <strong>{exportStats.estimatedBytes ? `${(exportStats.estimatedBytes / 1024 / 1024).toFixed(2)} MB` : "-"}</strong>
              <span>Rendered file</span>
              <strong>{exportFileSize !== null ? `${(exportFileSize / 1024 / 1024).toFixed(2)} MB` : "Not rendered yet"}</strong>
            </div>

            {downloadUrl && (
              <div className="export-preview rendered-output">
                <div className="export-preview-head">
                  <span>Final rendered preview</span>
                  <strong>{exportFileSize !== null ? `${(exportFileSize / 1024 / 1024).toFixed(2)} MB` : "Ready"}</strong>
                </div>
                <div className="export-preview-stage">
                  <img src={downloadUrl} alt="Final exported GIF preview" />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="button export" type="button" disabled={!canEdit || exportProgress !== null} onClick={exportGif}>
                {exportProgress !== null ? `Rendering ${Math.round(exportProgress * 100)}%` : "Render GIF"}
              </button>
              {exportProgress !== null && (
                <button className="button danger" type="button" onClick={cancelExport}>
                  Cancel after current step
                </button>
              )}
              {downloadUrl && (
                <a className="button download" href={downloadUrl} download={`${exportBaseName}.gif`}>
                  Download GIF
                </a>
              )}
              <button className="button quiet" type="button" disabled={!downloadUrl || isUploadingToGiphy || exportProgress !== null} onClick={() => void uploadToGiphy()}>
                {isUploadingToGiphy ? "Uploading to GIPHY..." : "Upload to GIPHY"}
              </button>
              {giphyUploadResult?.url && (
                <a className="button download" href={giphyUploadResult.url} target="_blank" rel="noreferrer">
                  Open on GIPHY
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
              <button className="mini-button icon-only-button" type="button" aria-label="Close animated icon browser" title="Close" onClick={closeIconModal} disabled={iconImportingId !== null}><Icon name="close" /></button>
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
