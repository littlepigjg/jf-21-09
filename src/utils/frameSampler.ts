export interface SampledFrame<T> {
  data: T;
  delay: number;
}

export interface ProcessedFrameData {
  imageData: ImageData;
  delay: number;
}

export function sampleFramesByFps<T extends { delay: number }>(
  frames: T[],
  targetFps: number
): SampledFrame<T>[] {
  if (frames.length === 0) return [];

  const minDelay = Math.max(1, Math.round(1000 / targetFps));
  const sampled: SampledFrame<T>[] = [];
  let accumulatedDelay = 0;

  for (const frame of frames) {
    accumulatedDelay += frame.delay;

    while (accumulatedDelay >= minDelay) {
      sampled.push({
        data: frame,
        delay: accumulatedDelay >= minDelay ? minDelay : accumulatedDelay,
      });
      accumulatedDelay -= minDelay;
    }
  }

  if (sampled.length === 0) {
    const lastFrame = frames[frames.length - 1];
    sampled.push({
      data: lastFrame,
      delay: Math.max(accumulatedDelay, minDelay),
    });
  } else if (accumulatedDelay > 0) {
    sampled[sampled.length - 1].delay += accumulatedDelay;
  }

  return sampled;
}

export function sampleProcessedFrames(
  frames: ProcessedFrameData[],
  targetFps: number
): ProcessedFrameData[] {
  const sampled = sampleFramesByFps(frames, targetFps);
  return sampled.map((s) => ({
    imageData: s.data.imageData,
    delay: s.delay,
  }));
}
