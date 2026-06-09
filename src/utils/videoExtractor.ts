import type { Frame } from '@/types';
import { generateId } from './imageUtils';

export interface VideoExtractOptions {
  fps: number;
  maxFrames: number;
  onProgress?: (percent: number) => void;
}

interface ExtractTask {
  time: number;
  resolve: (imageData: ImageData) => void;
}

export async function extractFramesFromVideo(
  file: File,
  options: VideoExtractOptions
): Promise<Frame[]> {
  const { fps, maxFrames, onProgress } = options;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('视频加载失败'));
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new Error('无法获取视频时长'));
        return;
      }

      const totalFrames = Math.min(maxFrames, Math.max(1, Math.floor(duration * fps)));
      const interval = duration / totalFrames;
      const frames: Frame[] = [];

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        reject(new Error('Canvas context not available'));
        return;
      }

      const queue: ExtractTask[] = [];
      for (let i = 0; i < totalFrames; i++) {
        queue.push({ time: i * interval, resolve: () => {} });
      }

      let currentIndex = 0;
      let isSeeking = false;

      const captureFrame = (task: ExtractTask): Promise<ImageData> => {
        return new Promise<ImageData>((res, rej) => {
          task.resolve = res;

          const handleSeeked = () => {
            try {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              video.removeEventListener('seeked', handleSeeked);
              video.removeEventListener('error', handleError);
              res(imageData);
            } catch (e) {
              video.removeEventListener('seeked', handleSeeked);
              video.removeEventListener('error', handleError);
              rej(e);
            }
          };

          const handleError = () => {
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
            rej(new Error('帧捕获失败'));
          };

          video.addEventListener('seeked', handleSeeked, { once: true });
          video.addEventListener('error', handleError, { once: true });

          try {
            video.currentTime = Math.min(task.time, duration - 0.01);
          } catch (e) {
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
            rej(e);
          }
        });
      };

      const processNext = async () => {
        if (currentIndex >= queue.length) {
          cleanup();
          resolve(frames);
          return;
        }

        if (isSeeking) return;
        isSeeking = true;

        try {
          const task = queue[currentIndex];
          const imageData = await captureFrame(task);

          frames.push({
            id: generateId(),
            imageData,
            delay: Math.round(1000 / fps),
            width: canvas.width,
            height: canvas.height,
            disposalMethod: 2,
          });

          currentIndex++;
          isSeeking = false;

          if (onProgress) {
            onProgress(Math.round((currentIndex / totalFrames) * 100));
          }

          setTimeout(processNext, 10);
        } catch (err) {
          currentIndex++;
          isSeeking = false;

          if (currentIndex < queue.length) {
            setTimeout(processNext, 10);
          } else if (frames.length > 0) {
            cleanup();
            resolve(frames);
          } else {
            cleanup();
            reject(err);
          }
        }
      };

      processNext();
    };
  });
}
