import GIF from 'gif.js';
import type { Frame, Caption, CropConfig, ExportConfig } from '@/types';
import { processAllFrames } from './frameProcessor';
import { sampleProcessedFrames } from './frameSampler';
import { quantizePalette, applyDithering, findClosestColor } from './colorQuantizer';
import { encodeGifMainThread } from './gif/mainThreadEncoder';

export interface ExportProgress {
  current: number;
  total: number;
  percent: number;
}

let workerAvailabilityCache: boolean | null = null;

async function checkWorkerAvailability(workerScript: string): Promise<boolean> {
  if (workerAvailabilityCache !== null) {
    return workerAvailabilityCache;
  }

  if (typeof Worker === 'undefined') {
    workerAvailabilityCache = false;
    return false;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      let worker: Worker | null = null;

      const timeoutId = setTimeout(() => {
        if (!resolved && worker) {
          worker.terminate();
          worker = null;
          reject(new Error('Worker load timeout'));
        }
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (worker) {
          worker.terminate();
          worker = null;
        }
      };

      try {
        worker = new Worker(workerScript);
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
        return;
      }

      worker.onmessage = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      worker.onerror = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Worker load error'));
      };

      try {
        worker.postMessage({});
      } catch (err) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    });
    workerAvailabilityCache = true;
    return true;
  } catch {
    workerAvailabilityCache = false;
    return false;
  }
}

function applyPaletteQuantization(
  frames: { imageData: ImageData; delay: number }[],
  colors: number,
  dither: boolean
): { imageData: ImageData; delay: number }[] {
  if (colors >= 256) return frames;

  const imageDataList = frames.map((f) => f.imageData);
  const palette = quantizePalette(imageDataList, colors);

  return frames.map((f) => {
    let quantizedData: ImageData;

    if (dither) {
      quantizedData = applyDithering(f.imageData, palette);
    } else {
      quantizedData = new ImageData(f.imageData.width, f.imageData.height);
      for (let i = 0; i < f.imageData.data.length; i += 4) {
        if (f.imageData.data[i + 3] > 0) {
          const idx = findClosestColor(
            palette,
            f.imageData.data[i],
            f.imageData.data[i + 1],
            f.imageData.data[i + 2]
          );
          quantizedData.data[i] = palette[idx].r;
          quantizedData.data[i + 1] = palette[idx].g;
          quantizedData.data[i + 2] = palette[idx].b;
          quantizedData.data[i + 3] = f.imageData.data[i + 3];
        }
      }
    }

    return { imageData: quantizedData, delay: f.delay };
  });
}

async function exportWithWorker(
  finalFrames: { imageData: ImageData; delay: number }[],
  exportConfig: ExportConfig,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const width = finalFrames[0].imageData.width;
  const height = finalFrames[0].imageData.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context not available');
  }

  const gifOptions: ConstructorParameters<typeof GIF>[0] = {
    workers: 2,
    quality: Math.max(1, 11 - Math.round(exportConfig.quality / 10)),
    width,
    height,
    repeat: exportConfig.repeat,
    workerScript: '/gif.worker.js',
  };

  const gif = new GIF(gifOptions);

  for (const frame of finalFrames) {
    ctx.putImageData(frame.imageData, 0, 0);
    gif.addFrame(ctx, { copy: true, delay: frame.delay });
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { gif.abort(); } catch (_) { /* ignore */ }
        reject(new Error('GIF encoding timeout'));
      }
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    gif.on('progress', (p: number) => {
      if (settled) return;
      if (onProgress) {
        onProgress({
          current: Math.round(p * finalFrames.length),
          total: finalFrames.length,
          percent: Math.round(p * 100),
        });
      }
    });

    gif.on('finished', (blob: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    });

    (gif as unknown as { on: (event: string, listener: (err: Error) => void) => void }).on(
      'error',
      (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        try { gif.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    );

    try {
      gif.render();
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }
  });
}

async function exportWithMainThread(
  finalFrames: { imageData: ImageData; delay: number }[],
  exportConfig: ExportConfig,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  return encodeGifMainThread(
    finalFrames.map((f) => ({ imageData: f.imageData, delay: f.delay })),
    {
      repeat: exportConfig.repeat,
      quality: Math.max(1, 11 - Math.round(exportConfig.quality / 10)),
      dither: false,
      onProgress,
    }
  );
}

export async function exportGif(
  frames: Frame[],
  captions: Caption[],
  crop: CropConfig,
  exportConfig: ExportConfig,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const processedFrames = processAllFrames(
    frames,
    captions,
    crop,
    exportConfig.width,
    exportConfig.height
  );

  if (processedFrames.length === 0) {
    throw new Error('没有可用帧');
  }

  const sampledFrames = sampleProcessedFrames(processedFrames, exportConfig.fps);

  if (sampledFrames.length === 0) {
    throw new Error('帧采样失败');
  }

  const finalFrames = applyPaletteQuantization(
    sampledFrames,
    exportConfig.colors,
    exportConfig.dither
  );

  const workerAvailable = await checkWorkerAvailability('/gif.worker.js');

  if (workerAvailable) {
    try {
      return await exportWithWorker(finalFrames, exportConfig, onProgress);
    } catch (workerErr) {
      console.warn('Worker mode failed, falling back to main thread:', workerErr);
      resetWorkerAvailabilityCache();
    }
  }

  return exportWithMainThread(finalFrames, exportConfig, onProgress);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function resetWorkerAvailabilityCache(): void {
  workerAvailabilityCache = null;
}
