/// <reference lib="webworker" />

import { decompressFrames, parseGIF } from "gifuct-js";

const workerScope = self as DedicatedWorkerGlobalScope;

type DecodeRequest = {
  id: string;
  name: string;
  buffer: ArrayBuffer;
};

type DecodedFrame = {
  index: number;
  delay: number;
  data: ArrayBuffer;
};

function compositePatch(target: Uint8ClampedArray, width: number, frame: { dims: { left: number; top: number; width: number; height: number }; patch: Uint8ClampedArray }) {
  for (let y = 0; y < frame.dims.height; y += 1) {
    for (let x = 0; x < frame.dims.width; x += 1) {
      const sourceIndex = (y * frame.dims.width + x) * 4;
      const targetX = frame.dims.left + x;
      const targetY = frame.dims.top + y;
      const targetIndex = (targetY * width + targetX) * 4;
      target[targetIndex] = frame.patch[sourceIndex];
      target[targetIndex + 1] = frame.patch[sourceIndex + 1];
      target[targetIndex + 2] = frame.patch[sourceIndex + 2];
      target[targetIndex + 3] = frame.patch[sourceIndex + 3];
    }
  }
}

workerScope.onmessage = ({ data }: MessageEvent<DecodeRequest>) => {
  try {
    const parsed = parseGIF(data.buffer);
    const decoded = decompressFrames(parsed, true) as Array<{
      dims: { left: number; top: number; width: number; height: number };
      patch: Uint8ClampedArray;
      delay: number;
      disposalType: number;
    }>;
    const gifMeta = parsed as unknown as { lsd: { width: number; height: number } };
    const width = gifMeta.lsd.width;
    const height = gifMeta.lsd.height;
    let current = new Uint8ClampedArray(width * height * 4);
    const frames: DecodedFrame[] = [];
    const transfers: Transferable[] = [];

    decoded.forEach((frame, index) => {
      const before = current.slice();
      compositePatch(current, width, frame);
      const snapshot = current.slice();
      frames.push({
        index,
        delay: Math.max(20, frame.delay || 100),
        data: snapshot.buffer,
      });
      transfers.push(snapshot.buffer);

      if (frame.disposalType === 2) {
        for (let y = 0; y < frame.dims.height; y += 1) {
          for (let x = 0; x < frame.dims.width; x += 1) {
            const targetX = frame.dims.left + x;
            const targetY = frame.dims.top + y;
            const targetIndex = (targetY * width + targetX) * 4;
            current[targetIndex] = 0;
            current[targetIndex + 1] = 0;
            current[targetIndex + 2] = 0;
            current[targetIndex + 3] = 0;
          }
        }
      }

      if (frame.disposalType === 3) current = before;

      if (index === decoded.length - 1 || index % 8 === 0) {
        workerScope.postMessage({ id: data.id, type: "progress", progress: (index + 1) / decoded.length });
      }
    });

    workerScope.postMessage({ id: data.id, type: "done", width, height, frames }, transfers);
  } catch (error) {
    workerScope.postMessage({ id: data.id, type: "error", message: error instanceof Error ? error.message : `Failed to decode ${data.name}.` });
  }
};
