/// <reference lib="webworker" />

import { decompressFrames, parseGIF } from "gifuct-js";

const workerScope = self;

function compositePatch(target, width, height, frame) {
  for (let y = 0; y < frame.dims.height; y += 1) {
    for (let x = 0; x < frame.dims.width; x += 1) {
      const sourceIndex = (y * frame.dims.width + x) * 4;
      const targetX = frame.dims.left + x;
      const targetY = frame.dims.top + y;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      const targetIndex = (targetY * width + targetX) * 4;
      if (targetIndex < 0 || targetIndex + 3 >= target.length) continue;
      // Transparent GIF patch pixels mean "leave the previous canvas pixel as-is".
      if (frame.patch[sourceIndex + 3] === 0) continue;
      target[targetIndex] = frame.patch[sourceIndex];
      target[targetIndex + 1] = frame.patch[sourceIndex + 1];
      target[targetIndex + 2] = frame.patch[sourceIndex + 2];
      target[targetIndex + 3] = frame.patch[sourceIndex + 3];
    }
  }
}

workerScope.onmessage = ({ data }) => {
  try {
    const parsed = parseGIF(data.buffer);
    const decoded = decompressFrames(parsed, true);
    const gifMeta = parsed;
    const width = gifMeta.lsd.width;
    const height = gifMeta.lsd.height;
    let current = new Uint8ClampedArray(width * height * 4);
    const frames = [];
    const transfers = [];

    decoded.forEach((frame, index) => {
      const before = current.slice();
      compositePatch(current, width, height, frame);
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
            if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
            const targetIndex = (targetY * width + targetX) * 4;
            if (targetIndex < 0 || targetIndex + 3 >= current.length) continue;
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
