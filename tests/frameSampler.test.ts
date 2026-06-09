import { describe, it, expect } from 'vitest';
import { sampleFramesByFps } from '../src/utils/frameSampler';

interface TestFrame {
  id: string;
  delay: number;
}

function makeFrames(count: number, delay: number): TestFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `frame-${i}`,
    delay,
  }));
}

function totalDelay<T extends { delay: number }>(frames: T[]): number {
  return frames.reduce((sum, f) => sum + f.delay, 0);
}

describe('sampleFramesByFps - 基础功能', () => {
  it('空帧数组应返回空数组', () => {
    const result = sampleFramesByFps<TestFrame>([], 10);
    expect(result).toEqual([]);
  });

  it('单帧且延迟正好等于阈值时返回1帧', () => {
    const frames = makeFrames(1, 100);
    const result = sampleFramesByFps(frames, 10);
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe(frames[0]);
    expect(result[0].delay).toBe(100);
  });

  it('10fps阈值为100ms', () => {
    const frames = makeFrames(1, 100);
    const result = sampleFramesByFps(frames, 10);
    expect(result[0].delay).toBe(100);
  });

  it('5fps阈值为200ms', () => {
    const frames = makeFrames(1, 200);
    const result = sampleFramesByFps(frames, 5);
    expect(result[0].delay).toBe(200);
  });
});

describe('sampleFramesByFps - 余数累加逻辑', () => {
  it('末尾余数应累加到最后一个采样帧而非新增帧', () => {
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

  it('末尾帧延迟足够时作为新采样帧，余数累加到自身', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 30 },
      { id: 'c', delay: 120 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[0].data.id).toBe('a');
    expect(result[0].delay).toBe(100);
    expect(result[1].data.id).toBe('c');
    expect(result[1].delay).toBe(150);
    expect(totalDelay(result)).toBe(250);
  });

  it('无余数时最后一帧delay保持不变', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 100 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[0].delay).toBe(100);
    expect(result[1].delay).toBe(100);
  });

  it('单帧不足阈值时仍返回一帧，delay至少为阈值', () => {
    const frames = makeFrames(1, 50);
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(1);
    expect(result[0].delay).toBe(100);
  });

  it('多帧累加但未达阈值时返回最后一帧', () => {
    const frames = [
      { id: 'a', delay: 30 },
      { id: 'b', delay: 40 },
      { id: 'c', delay: 20 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(1);
    expect(result[0].data.id).toBe('c');
    expect(result[0].delay).toBe(100);
  });
});

describe('sampleFramesByFps - 时间守恒', () => {
  it('总时长应等于原始帧总时长', () => {
    const frames = makeFrames(10, 100);
    const result = sampleFramesByFps(frames, 10);
    expect(totalDelay(result)).toBe(totalDelay(frames));
  });

  it('存在余数时总时长仍守恒', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 100 },
      { id: 'c', delay: 75 },
      { id: 'd', delay: 80 },
    ];
    const result = sampleFramesByFps(frames, 10);
    expect(totalDelay(result)).toBe(totalDelay(frames));
  });

  it('高帧率下总时长守恒', () => {
    const frames = makeFrames(5, 50);
    const result = sampleFramesByFps(frames, 30);
    expect(totalDelay(result)).toBe(totalDelay(frames));
  });

  it('低帧率跳帧时总时长仍守恒', () => {
    const frames = makeFrames(20, 50);
    const result = sampleFramesByFps(frames, 5);
    expect(totalDelay(result)).toBe(totalDelay(frames));
  });
});

describe('sampleFramesByFps - 复杂场景', () => {
  it('一帧贡献多个采样点', () => {
    const frames = [{ id: 'a', delay: 250 }];
    const result = sampleFramesByFps(frames, 10);

    expect(result).toHaveLength(2);
    expect(result[0].data).toBe(frames[0]);
    expect(result[0].delay).toBe(100);
    expect(result[1].data).toBe(frames[0]);
    expect(result[1].delay).toBe(150);
    expect(totalDelay(result)).toBe(250);
  });

  it('混合延迟的复杂序列', () => {
    const frames = [
      { id: 'a', delay: 150 },
      { id: 'b', delay: 80 },
      { id: 'c', delay: 300 },
      { id: 'd', delay: 60 },
    ];
    const result = sampleFramesByFps(frames, 10);

    expect(totalDelay(result)).toBe(590);
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result[0].delay).toBe(100);
    expect(result[result.length - 1].delay).toBeGreaterThanOrEqual(100);
  });

  it('保持原始帧顺序', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 100 },
      { id: 'c', delay: 100 },
      { id: 'd', delay: 100 },
    ];
    const result = sampleFramesByFps(frames, 10);

    const ids = result.map((r) => r.data.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('不会重复添加末尾帧', () => {
    const frames = [
      { id: 'a', delay: 100 },
      { id: 'b', delay: 150 },
    ];
    const result = sampleFramesByFps(frames, 10);

    const bCount = result.filter((r) => r.data.id === 'b').length;
    expect(bCount).toBe(1);
    expect(result).toHaveLength(2);
  });
});
