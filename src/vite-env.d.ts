/// <reference types="vite/client" />

declare module "gif.js" {
  type GifOptions = {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    repeat?: number;
    background?: string;
    transparent?: number | null;
    dither?: boolean | string;
  };

  type GifFrameOptions = {
    delay?: number;
    copy?: boolean;
    dispose?: number;
  };

  export default class GIF {
    constructor(options?: GifOptions);
    addFrame(frame: CanvasRenderingContext2D | HTMLCanvasElement | ImageData, options?: GifFrameOptions): void;
    on(event: "progress", callback: (progress: number) => void): void;
    on(event: "finished", callback: (blob: Blob) => void): void;
    render(): void;
  }
}
