import { parseGIF, decompressFrames } from 'gifuct-js';
import type { Frame } from '@/types';
import { generateId, cloneImageData } from './imageUtils';

interface ParsedFrame {
  dims: { width: number; height: number; top: number; left: number };
  delay: number;
  disposalType: number;
  patch: Uint8ClampedArray;
}

export async function decodeGif(file: File): Promise<Frame[]> {
  const arrayBuffer = await file.arrayBuffer();
  const gif = parseGIF(arrayBuffer);
  const frames = decompressFrames(gif, true) as ParsedFrame[];

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const resultFrames: Frame[] = [];
  let fullImageData: ImageData | null = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    
    if (i === 0 || frame.disposalType === 2 || frame.disposalType === 3) {
      fullImageData = new ImageData(width, height);
    }

    if (!fullImageData) {
      fullImageData = new ImageData(width, height);
    }

    const patchData = frame.patch;
    for (let y = 0; y < frame.dims.height; y++) {
      for (let x = 0; x < frame.dims.width; x++) {
        const srcIdx = (y * frame.dims.width + x) * 4;
        const dstX = frame.dims.left + x;
        const dstY = frame.dims.top + y;
        const dstIdx = (dstY * width + dstX) * 4;
        
        if (patchData[srcIdx + 3] > 0) {
          fullImageData.data[dstIdx] = patchData[srcIdx];
          fullImageData.data[dstIdx + 1] = patchData[srcIdx + 1];
          fullImageData.data[dstIdx + 2] = patchData[srcIdx + 2];
          fullImageData.data[dstIdx + 3] = patchData[srcIdx + 3];
        }
      }
    }

    resultFrames.push({
      id: generateId(),
      imageData: cloneImageData(fullImageData),
      delay: frame.delay > 0 ? frame.delay * 10 : 100,
      width,
      height,
      disposalMethod: frame.disposalType,
    });
  }

  return resultFrames;
}
