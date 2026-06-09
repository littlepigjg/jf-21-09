import { describe, it, expect, beforeEach } from 'vitest';
import { sampleFramesByFps } from '../src/utils/frameSampler';
import { encodeGifMainThread } from '../src/utils/gif/mainThreadEncoder';

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const globalAny = globalThis as unknown as { ImageData: typeof ImageData };
if (typeof globalAny.ImageData === 'undefined') {
  globalAny.ImageData = MockImageData as unknown as typeof ImageData;
}

function createTestImageData(width: number, height: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return new globalAny.ImageData(data, width, height);
}

describe('frameSampler - 末尾余数累加', () => {
  it('余数不产生新帧，直接累加到最后一个已采样帧', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 100 },
      { id: 'c', delay: 50 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[0].data.id).toBe('a');
    expect(result[0].delay).toBe(100);
    expect(result[1].data.id).toBe('b');
    expect(result[1].delay).toBe(150);
  });

  it('无余数时不修改最后一帧delay', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 100 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[0].delay).toBe(100);
    expect(result[1].delay).toBe(100);
  });

  it('不会因为余数而重复添加最后一帧', () => {
    const frames = [
      { id: 'a', delay: 80 },
      { id: 'b', delay: 80 },
      { id: 'c', delay: 80 },
    ];
    const result = sampleFramesByFps(frames, 10);

    const bCount = result.filter((r) => r.data.id === 'b').length;
    const cCount = result.filter((r) => r.data.id === 'c').length;
    expect(cCount).toBeLessThanOrEqual(2);
    expect(bCount + cCount).toBeLessThanOrEqual(3);
  });

  it('最后一帧数据始终是已采样帧中的最后一个，不是单独新增', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 110 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[result.length - 1].data.id).toBe('b');
    expect(result[result.length - 1].delay).toBeGreaterThanOrEqual(100);
  });
});

describe('mainThreadEncoder - 纯主线程编码', () => {
  it('能成功编码简单GIF', async () => {
    const frames = [
      { imageData: createTestImageData(10, 10, 255, 0, 0), delay: 100 },
      { imageData: createTestImageData(10, 10, 0, 255, 0), delay: 100 },
      { imageData: createTestImageData(10, 10, 0, 0, 255), delay: 100 },
    ];

    const blob = await encodeGifMainThread(frames);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/gif');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('报告进度回调', async () => {
    const progressCalls: { current: number; total: number; percent: number }[] = [];
    const frames = [
      { imageData: createTestImageData(5, 5, 255, 0, 0), delay: 50 },
      { imageData: createTestImageData(5, 5, 0, 255, 0), delay: 50 },
    ];

    await encodeGifMainThread(frames, {
      onProgress: (p) => progressCalls.push({ ...p }),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1].percent).toBe(100);
    expect(progressCalls[progressCalls.length - 1].current).toBe(2);
    expect(progressCalls[progressCalls.length - 1].total).toBe(2);
  });

  it('空帧数组抛出错误', async () => {
    await expect(encodeGifMainThread([])).rejects.toThrow();
  });

  it('单帧也能正常编码', async () => {
    const frames = [
      { imageData: createTestImageData(8, 8, 128, 128, 128), delay: 500 },
    ];

    const blob = await encodeGifMainThread(frames);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('image/gif');
  });
});

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('编码输出验证', () => {
  it('输出包含GIF89a头', async () => {
    const frames = [
      { imageData: createTestImageData(4, 4, 200, 100, 50), delay: 100 },
    ];

    const blob = await encodeGifMainThread(frames);
    const bytes = await blobToUint8Array(blob);
    const header = String.fromCharCode(...bytes.slice(0, 6));

    expect(header).toBe('GIF89a');
  });

  it('输出以0x3B结尾(GIF trailer)', async () => {
    const frames = [
      { imageData: createTestImageData(3, 3, 0, 0, 0), delay: 200 },
      { imageData: createTestImageData(3, 3, 255, 255, 255), delay: 200 },
    ];

    const blob = await encodeGifMainThread(frames);
    const bytes = await blobToUint8Array(blob);

    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });
});
