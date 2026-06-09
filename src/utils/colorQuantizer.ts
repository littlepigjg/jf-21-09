interface Color {
  r: number;
  g: number;
  b: number;
}

interface ColorBox {
  colors: Color[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

function getRange(box: ColorBox): 'r' | 'g' | 'b' {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;

  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= bRange) return 'g';
  return 'b';
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] {
  const range = getRange(box);
  const sorted = [...box.colors].sort((a, b) => a[range] - b[range]);
  const mid = Math.floor(sorted.length / 2);

  const leftColors = sorted.slice(0, mid);
  const rightColors = sorted.slice(mid);

  const makeBox = (colors: Color[]): ColorBox => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of colors) {
      if (c.r < rMin) rMin = c.r;
      if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g;
      if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b;
      if (c.b > bMax) bMax = c.b;
    }
    return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
  };

  return [makeBox(leftColors), makeBox(rightColors)];
}

export function quantizePalette(imageDataList: ImageData[], maxColors: number): Color[] {
  const allColors: Color[] = [];

  for (const imageData of imageDataList) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        allColors.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
  }

  if (allColors.length === 0) {
    return [{ r: 0, g: 0, b: 0 }];
  }

  let initialRMin = 255, initialRMax = 0, initialGMin = 255, initialGMax = 0, initialBMin = 255, initialBMax = 0;
  for (const c of allColors) {
    if (c.r < initialRMin) initialRMin = c.r;
    if (c.r > initialRMax) initialRMax = c.r;
    if (c.g < initialGMin) initialGMin = c.g;
    if (c.g > initialGMax) initialGMax = c.g;
    if (c.b < initialBMin) initialBMin = c.b;
    if (c.b > initialBMax) initialBMax = c.b;
  }

  let boxes: ColorBox[] = [{
    colors: allColors,
    rMin: initialRMin, rMax: initialRMax,
    gMin: initialGMin, gMax: initialGMax,
    bMin: initialBMin, bMax: initialBMax,
  }];

  while (boxes.length < maxColors) {
    boxes.sort((a, b) => {
      const aRange = (a.rMax - a.rMin) + (a.gMax - a.gMin) + (a.bMax - a.bMin);
      const bRange = (b.rMax - b.rMin) + (b.gMax - b.gMin) + (b.bMax - b.bMin);
      return bRange - aRange;
    });

    const boxToSplit = boxes.shift();
    if (!boxToSplit || boxToSplit.colors.length < 2) break;

    const [left, right] = splitBox(boxToSplit);
    boxes.push(left, right);
  }

  return boxes.map((box) => {
    let rSum = 0, gSum = 0, bSum = 0;
    for (const c of box.colors) {
      rSum += c.r;
      gSum += c.g;
      bSum += c.b;
    }
    const count = box.colors.length;
    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  });
}

export function findClosestColor(palette: Color[], r: number, g: number, b: number): number {
  let minDist = Infinity;
  let minIndex = 0;

  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i].r;
    const dg = g - palette[i].g;
    const db = b - palette[i].b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      minIndex = i;
    }
  }

  return minIndex;
}

export function applyDithering(imageData: ImageData, palette: Color[]): ImageData {
  const result = new ImageData(imageData.width, imageData.height);
  const width = imageData.width;
  const height = imageData.height;
  const buffer = new Float32Array(width * height * 3);

  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    buffer[j] = imageData.data[i];
    buffer[j + 1] = imageData.data[i + 1];
    buffer[j + 2] = imageData.data[i + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const oldR = Math.max(0, Math.min(255, buffer[idx]));
      const oldG = Math.max(0, Math.min(255, buffer[idx + 1]));
      const oldB = Math.max(0, Math.min(255, buffer[idx + 2]));

      const paletteIndex = findClosestColor(palette, oldR, oldG, oldB);
      const newR = palette[paletteIndex].r;
      const newG = palette[paletteIndex].g;
      const newB = palette[paletteIndex].b;

      const pixelIdx = (y * width + x) * 4;
      result.data[pixelIdx] = newR;
      result.data[pixelIdx + 1] = newG;
      result.data[pixelIdx + 2] = newB;
      result.data[pixelIdx + 3] = imageData.data[pixelIdx + 3];

      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      if (x + 1 < width) {
        const nIdx = idx + 3;
        buffer[nIdx] += errR * 7 / 16;
        buffer[nIdx + 1] += errG * 7 / 16;
        buffer[nIdx + 2] += errB * 7 / 16;
      }
      if (y + 1 < height) {
        if (x > 0) {
          const nIdx = idx + width * 3 - 3;
          buffer[nIdx] += errR * 3 / 16;
          buffer[nIdx + 1] += errG * 3 / 16;
          buffer[nIdx + 2] += errB * 3 / 16;
        }
        const nIdx = idx + width * 3;
        buffer[nIdx] += errR * 5 / 16;
        buffer[nIdx + 1] += errG * 5 / 16;
        buffer[nIdx + 2] += errB * 5 / 16;
        if (x + 1 < width) {
          const nIdx2 = idx + width * 3 + 3;
          buffer[nIdx2] += errR * 1 / 16;
          buffer[nIdx2 + 1] += errG * 1 / 16;
          buffer[nIdx2 + 2] += errB * 1 / 16;
        }
      }
    }
  }

  return result;
}
