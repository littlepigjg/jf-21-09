/*
  GIFEncoder.js

  Authors
  Kevin Weiner (original Java version - kweiner@fmsware.com)
  Thibault Imbert (AS3 version - bytearray.org)
  Johan Nordberg (JS version - code@johan-nordberg.com)
*/

import { NeuQuant } from './TypedNeuQuant';
import { LZWEncoder } from './LZWEncoder';

class ByteArray {
  public page = -1;
  public pages: Uint8Array[] = [];
  public cursor = 0;
  static pageSize = 4096;
  static charMap: { [key: number]: string } = {};

  constructor() {
    this.newPage();
  }

  static {
    for (let i = 0; i < 256; i++) {
      ByteArray.charMap[i] = String.fromCharCode(i);
    }
  }

  newPage(): void {
    this.pages[++this.page] = new Uint8Array(ByteArray.pageSize);
    this.cursor = 0;
  }

  getData(): string {
    let rv = '';
    for (let p = 0; p < this.pages.length; p++) {
      for (let i = 0; i < ByteArray.pageSize; i++) {
        rv += ByteArray.charMap[this.pages[p][i]];
      }
    }
    return rv;
  }

  writeByte(val: number): void {
    if (this.cursor >= ByteArray.pageSize) this.newPage();
    this.pages[this.page][this.cursor++] = val;
  }

  writeUTFBytes(string: string): void {
    for (let l = string.length, i = 0; i < l; i++) {
      this.writeByte(string.charCodeAt(i));
    }
  }

  writeBytes(array: Uint8Array, offset?: number, length?: number): void {
    for (let l = length || array.length, i = offset || 0; i < l; i++) {
      this.writeByte(array[i]);
    }
  }
}

type DitherMethod = boolean | 'FalseFloydSteinberg' | 'FloydSteinberg' | 'Stucki' | 'Atkinson' | string;

export class GIFEncoder {
  public width: number;
  public height: number;
  public transparent: string | number | null = null;
  public transIndex = 0;
  public repeat = -1;
  public delay = 0;
  public image: Uint8ClampedArray | null = null;
  public pixels: Uint8Array | null = null;
  public indexedPixels: Uint8Array | null = null;
  public colorDepth: number | null = null;
  public colorTab: number[] | null = null;
  public neuQuant: NeuQuant | null = null;
  public usedEntry: boolean[] = [];
  public palSize = 7;
  public dispose = -1;
  public firstFrame = true;
  public sample = 10;
  public dither: DitherMethod = false;
  public globalPalette: boolean | number[] = false;
  public out: ByteArray;

  constructor(width: number, height: number) {
    this.width = ~~width;
    this.height = ~~height;
    this.out = new ByteArray();
  }

  setDelay(milliseconds: number): void {
    this.delay = Math.round(milliseconds / 10);
  }

  setFrameRate(fps: number): void {
    this.delay = Math.round(100 / fps);
  }

  setDispose(disposalCode: number): void {
    if (disposalCode >= 0) this.dispose = disposalCode;
  }

  setRepeat(repeat: number): void {
    this.repeat = repeat;
  }

  setTransparent(color: string | number | null): void {
    this.transparent = color;
  }

  addFrame(imageData: Uint8ClampedArray): void {
    this.image = imageData;
    this.colorTab = this.globalPalette && Array.isArray(this.globalPalette) && this.globalPalette.slice ? this.globalPalette.slice() as number[] : null;

    this.getImagePixels();
    this.analyzePixels();

    if (this.globalPalette === true) this.globalPalette = this.colorTab!;

    if (this.firstFrame) {
      this.writeLSD();
      this.writePalette();
      if (this.repeat >= 0) {
        this.writeNetscapeExt();
      }
    }

    this.writeGraphicCtrlExt();
    this.writeImageDesc();
    if (!this.firstFrame && !this.globalPalette) this.writePalette();
    this.writePixels();

    this.firstFrame = false;
  }

  finish(): void {
    this.out.writeByte(0x3b);
  }

  setQuality(quality: number): void {
    if (quality < 1) quality = 1;
    this.sample = quality;
  }

  setDither(dither: DitherMethod): void {
    if (dither === true) dither = 'FloydSteinberg';
    this.dither = dither;
  }

  setGlobalPalette(palette: boolean | number[]): void {
    this.globalPalette = palette;
  }

  getGlobalPalette(): number[] | boolean {
    return (this.globalPalette && Array.isArray(this.globalPalette) && (this.globalPalette as number[]).slice) ?
      (this.globalPalette as number[]).slice(0) : this.globalPalette;
  }

  writeHeader(): void {
    this.out.writeUTFBytes('GIF89a');
  }

  analyzePixels(): void {
    if (!this.colorTab) {
      this.neuQuant = new NeuQuant(this.pixels!, this.sample);
      this.neuQuant.buildColormap();
      this.colorTab = this.neuQuant.getColormap();
    }

    if (this.dither) {
      const ditherStr = String(this.dither);
      this.ditherPixels(ditherStr.replace('-serpentine', ''), ditherStr.match(/-serpentine/) !== null);
    } else {
      this.indexPixels();
    }

    this.pixels = null;
    this.colorDepth = 8;
    this.palSize = 7;

    if (this.transparent !== null) {
      this.transIndex = this.findClosest(this.transparent, true);
    }
  }

  indexPixels(): void {
    const nPix = this.pixels!.length / 3;
    this.indexedPixels = new Uint8Array(nPix);
    let k = 0;
    for (let j = 0; j < nPix; j++) {
      const index = this.findClosestRGB(
        this.pixels![k++] & 0xff,
        this.pixels![k++] & 0xff,
        this.pixels![k++] & 0xff
      );
      this.usedEntry[index] = true;
      this.indexedPixels[j] = index;
    }
  }

  ditherPixels(kernel: string, serpentine: boolean): void {
    const kernels: { [key: string]: number[][] } = {
      FalseFloydSteinberg: [
        [3 / 8, 1, 0],
        [3 / 8, 0, 1],
        [2 / 8, 1, 1]
      ],
      FloydSteinberg: [
        [7 / 16, 1, 0],
        [3 / 16, -1, 1],
        [5 / 16, 0, 1],
        [1 / 16, 1, 1]
      ],
      Stucki: [
        [8 / 42, 1, 0],
        [4 / 42, 2, 0],
        [2 / 42, -2, 1],
        [4 / 42, -1, 1],
        [8 / 42, 0, 1],
        [4 / 42, 1, 1],
        [2 / 42, 2, 1],
        [1 / 42, -2, 2],
        [2 / 42, -1, 2],
        [4 / 42, 0, 2],
        [2 / 42, 1, 2],
        [1 / 42, 2, 2]
      ],
      Atkinson: [
        [1 / 8, 1, 0],
        [1 / 8, 2, 0],
        [1 / 8, -1, 1],
        [1 / 8, 0, 1],
        [1 / 8, 1, 1],
        [1 / 8, 0, 2]
      ]
    };

    if (!kernel || !kernels[kernel]) {
      throw new Error('Unknown dithering kernel: ' + kernel);
    }

    const ds = kernels[kernel];
    let index = 0;
    const height = this.height;
    const width = this.width;
    const data = this.pixels!;
    let direction = serpentine ? -1 : 1;

    this.indexedPixels = new Uint8Array(this.pixels!.length / 3);

    for (let y = 0; y < height; y++) {
      if (serpentine) direction = direction * -1;

      for (let x = direction == 1 ? 0 : width - 1, xend = direction == 1 ? width : 0; x !== xend; x += direction) {
        index = (y * width) + x;
        let idx = index * 3;
        const r1 = data[idx];
        const g1 = data[idx + 1];
        const b1 = data[idx + 2];

        idx = this.findClosestRGB(r1, g1, b1);
        this.usedEntry[idx] = true;
        this.indexedPixels[index] = idx;
        idx *= 3;
        const r2 = this.colorTab![idx];
        const g2 = this.colorTab![idx + 1];
        const b2 = this.colorTab![idx + 2];

        const er = r1 - r2;
        const eg = g1 - g2;
        const eb = b1 - b2;

        for (let i = direction == 1 ? 0 : ds.length - 1, end = direction == 1 ? ds.length : 0; i !== end; i += direction) {
          const x1 = ds[i][1];
          const y1 = ds[i][2];
          if (x1 + x >= 0 && x1 + x < width && y1 + y >= 0 && y1 + y < height) {
            const d = ds[i][0];
            idx = index + x1 + (y1 * width);
            idx *= 3;

            data[idx] = Math.max(0, Math.min(255, data[idx] + er * d));
            data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + eg * d));
            data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + eb * d));
          }
        }
      }
    }
  }

  findClosest(c: string | number, used: boolean): number {
    const num = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c;
    return this.findClosestRGB((num & 0xFF0000) >> 16, (num & 0x00FF00) >> 8, (num & 0x0000FF), used);
  }

  findClosestRGB(r: number, g: number, b: number, used?: boolean): number {
    if (this.colorTab === null) return -1;

    if (this.neuQuant && !used) {
      return this.neuQuant.lookupRGB(r, g, b);
    }

    const c = b | (g << 8) | (r << 16);

    let minpos = 0;
    let dmin = 256 * 256 * 256;
    const len = this.colorTab.length;

    for (let i = 0, index = 0; i < len; index++) {
      const dr = r - (this.colorTab[i++] & 0xff);
      const dg = g - (this.colorTab[i++] & 0xff);
      const db = b - (this.colorTab[i++] & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if ((!used || this.usedEntry[index]) && (d < dmin)) {
        dmin = d;
        minpos = index;
      }
    }

    return minpos;
  }

  getImagePixels(): void {
    const w = this.width;
    const h = this.height;
    this.pixels = new Uint8Array(w * h * 3);

    const data = this.image!;
    let srcPos = 0;
    let count = 0;

    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        this.pixels[count++] = data[srcPos++];
        this.pixels[count++] = data[srcPos++];
        this.pixels[count++] = data[srcPos++];
        srcPos++;
      }
    }
  }

  writeGraphicCtrlExt(): void {
    this.out.writeByte(0x21);
    this.out.writeByte(0xf9);
    this.out.writeByte(4);

    let transp: number, disp: number;
    if (this.transparent === null) {
      transp = 0;
      disp = 0;
    } else {
      transp = 1;
      disp = 2;
    }

    if (this.dispose >= 0) {
      disp = this.dispose & 7;
    }
    disp <<= 2;

    this.out.writeByte(
      0 |
      disp |
      0 |
      transp
    );

    this.writeShort(this.delay);
    this.out.writeByte(this.transIndex);
    this.out.writeByte(0);
  }

  writeImageDesc(): void {
    this.out.writeByte(0x2c);
    this.writeShort(0);
    this.writeShort(0);
    this.writeShort(this.width);
    this.writeShort(this.height);

    if (this.firstFrame || this.globalPalette) {
      this.out.writeByte(0);
    } else {
      this.out.writeByte(
        0x80 |
        0 |
        0 |
        0 |
        this.palSize
      );
    }
  }

  writeLSD(): void {
    this.writeShort(this.width);
    this.writeShort(this.height);

    this.out.writeByte(
      0x80 |
      0x70 |
      0x00 |
      this.palSize
    );

    this.out.writeByte(0);
    this.out.writeByte(0);
  }

  writeNetscapeExt(): void {
    this.out.writeByte(0x21);
    this.out.writeByte(0xff);
    this.out.writeByte(11);
    this.out.writeUTFBytes('NETSCAPE2.0');
    this.out.writeByte(3);
    this.out.writeByte(1);
    this.writeShort(this.repeat);
    this.out.writeByte(0);
  }

  writePalette(): void {
    this.out.writeBytes(new Uint8Array(this.colorTab!));
    const n = (3 * 256) - this.colorTab!.length;
    for (let i = 0; i < n; i++) {
      this.out.writeByte(0);
    }
  }

  writeShort(pValue: number): void {
    this.out.writeByte(pValue & 0xFF);
    this.out.writeByte((pValue >> 8) & 0xFF);
  }

  writePixels(): void {
    const enc = new LZWEncoder(this.width, this.height, this.indexedPixels!, this.colorDepth!);
    enc.encode(this.out);
  }

  stream(): ByteArray {
    return this.out;
  }
}
