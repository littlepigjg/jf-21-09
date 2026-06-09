import { GIFEncoder } from './GIFEncoder';

export interface GifFrame {
  imageData: ImageData;
  delay: number;
}

export interface EncodeOptions {
  repeat?: number;
  quality?: number;
  dither?: boolean;
  transparent?: string | number | null;
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
}

export function encodeGifMainThread(
  frames: GifFrame[],
  options: EncodeOptions = {}
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      if (frames.length === 0) {
        reject(new Error('没有可编码的帧'));
        return;
      }

      const width = frames[0].imageData.width;
      const height = frames[0].imageData.height;

      const encoder = new GIFEncoder(width, height);
      encoder.writeHeader();
      encoder.setRepeat(options.repeat ?? 0);
      encoder.setQuality(options.quality ?? 10);
      encoder.setDither(options.dither ?? false);
      if (options.transparent !== undefined) {
        encoder.setTransparent(options.transparent);
      }

      const processNextFrame = (index: number) => {
        if (index >= frames.length) {
          encoder.finish();
          const stream = encoder.stream();

          let totalLength = 0;
          for (let p = 0; p < stream.pages.length; p++) {
            if (p === stream.page) {
              totalLength += stream.cursor;
            } else {
              totalLength += 4096;
            }
          }

          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (let p = 0; p < stream.pages.length; p++) {
            const pageLen = p === stream.page ? stream.cursor : 4096;
            result.set(stream.pages[p].subarray(0, pageLen), offset);
            offset += pageLen;
          }

          resolve(new Blob([result], { type: 'image/gif' }));
          return;
        }

        try {
          const frame = frames[index];
          encoder.setDelay(frame.delay);
          encoder.addFrame(frame.imageData.data);

          if (options.onProgress) {
            options.onProgress({
              current: index + 1,
              total: frames.length,
              percent: Math.round(((index + 1) / frames.length) * 100),
            });
          }

          setTimeout(() => processNextFrame(index + 1), 0);
        } catch (err) {
          reject(err);
        }
      };

      processNextFrame(0);
    } catch (err) {
      reject(err);
    }
  });
}
