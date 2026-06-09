/* NeuQuant Neural-Net Quantization Algorithm
 * ------------------------------------------
 *
 * Copyright (c) 1994 Anthony Dekker
 *
 * NEUQUANT Neural-Net quantization algorithm by Anthony Dekker, 1994.
 * See "Kohonen neural networks for optimal colour quantization"
 * in "Network: Computation in Neural Systems" Vol. 5 (1994) pp 351-367.
 * for a discussion of the algorithm.
 * See also  http://members.ozemail.com.au/~dekker/NEUQUANT.HTML
 *
 * Any party obtaining a copy of these files from the author, directly or
 * indirectly, is granted, free of charge, a full and unrestricted irrevocable,
 * world-wide, paid up, royalty-free, nonexclusive right and license to deal
 * in this software and documentation files (the "Software"), including without
 * limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons who receive
 * copies from any such party to do so, with the only requirement being
 * that this copyright notice remain intact.
 *
 * (JavaScript port 2012 by Johan Nordberg)
 */

const ncycles = 100;
const netsize = 256;
const maxnetpos = netsize - 1;

const netbiasshift = 4;
const intbiasshift = 16;
const intbias = 1 << intbiasshift;
const gammashift = 10;
const gamma = 1 << gammashift;
const betashift = 10;
const beta = intbias >> betashift;
const betagamma = intbias << (gammashift - betashift);

const initrad = netsize >> 3;
const radiusbiasshift = 6;
const radiusbias = 1 << radiusbiasshift;
const initradius = initrad * radiusbias;
const radiusdec = 30;

const alphabiasshift = 10;
const initalpha = 1 << alphabiasshift;
let alphadec: number;

const radbiasshift = 8;
const radbias = 1 << radbiasshift;
const alpharadbshift = alphabiasshift + radbiasshift;
const alpharadbias = 1 << alpharadbshift;

const prime1 = 499;
const prime2 = 491;
const prime3 = 487;
const prime4 = 503;
const minpicturebytes = 3 * prime4;

export class NeuQuant {
  private network: Float64Array[] = [];
  private netindex: Int32Array;
  private bias: Int32Array;
  private freq: Int32Array;
  private radpower: Int32Array;

  constructor(private pixels: Uint8Array, private samplefac: number) {
    this.netindex = new Int32Array(256);
    this.bias = new Int32Array(netsize);
    this.freq = new Int32Array(netsize);
    this.radpower = new Int32Array(netsize >> 3);
  }

  private init(): void {
    this.network = [];
    let i: number, v: number;
    for (i = 0; i < netsize; i++) {
      v = (i << (netbiasshift + 8)) / netsize;
      this.network[i] = new Float64Array([v, v, v, 0]);
      this.freq[i] = intbias / netsize;
      this.bias[i] = 0;
    }
  }

  private unbiasnet(): void {
    for (let i = 0; i < netsize; i++) {
      this.network[i][0] >>= netbiasshift;
      this.network[i][1] >>= netbiasshift;
      this.network[i][2] >>= netbiasshift;
      this.network[i][3] = i;
    }
  }

  private altersingle(alpha: number, i: number, b: number, g: number, r: number): void {
    this.network[i][0] -= (alpha * (this.network[i][0] - b)) / initalpha;
    this.network[i][1] -= (alpha * (this.network[i][1] - g)) / initalpha;
    this.network[i][2] -= (alpha * (this.network[i][2] - r)) / initalpha;
  }

  private alterneigh(radius: number, i: number, b: number, g: number, r: number): void {
    const lo = Math.abs(i - radius);
    const hi = Math.min(i + radius, netsize);

    let j = i + 1;
    let k = i - 1;
    let m = 1;

    let p: Float64Array, a: number;
    while (j < hi || k > lo) {
      a = this.radpower[m++];

      if (j < hi) {
        p = this.network[j++];
        p[0] -= (a * (p[0] - b)) / alpharadbias;
        p[1] -= (a * (p[1] - g)) / alpharadbias;
        p[2] -= (a * (p[2] - r)) / alpharadbias;
      }

      if (k > lo) {
        p = this.network[k--];
        p[0] -= (a * (p[0] - b)) / alpharadbias;
        p[1] -= (a * (p[1] - g)) / alpharadbias;
        p[2] -= (a * (p[2] - r)) / alpharadbias;
      }
    }
  }

  private contest(b: number, g: number, r: number): number {
    let bestd = ~(1 << 31);
    let bestbiasd = bestd;
    let bestpos = -1;
    let bestbiaspos = bestpos;

    let i: number, n: Float64Array, dist: number, biasdist: number, betafreq: number;
    for (i = 0; i < netsize; i++) {
      n = this.network[i];

      dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }

      biasdist = dist - (this.bias[i] >> (intbiasshift - netbiasshift));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }

      betafreq = this.freq[i] >> betashift;
      this.freq[i] -= betafreq;
      this.bias[i] += betafreq << gammashift;
    }

    this.freq[bestpos] += beta;
    this.bias[bestpos] -= betagamma;

    return bestbiaspos;
  }

  private inxbuild(): void {
    let i: number, j: number, p: Float64Array, q: Float64Array;
    let smallpos: number, smallval: number;
    let previouscol = 0, startpos = 0;
    for (i = 0; i < netsize; i++) {
      p = this.network[i];
      smallpos = i;
      smallval = p[1];
      for (j = i + 1; j < netsize; j++) {
        q = this.network[j];
        if (q[1] < smallval) {
          smallpos = j;
          smallval = q[1];
        }
      }
      q = this.network[smallpos];
      if (i != smallpos) {
        j = q[0]; q[0] = p[0]; p[0] = j;
        j = q[1]; q[1] = p[1]; p[1] = j;
        j = q[2]; q[2] = p[2]; p[2] = j;
        j = q[3]; q[3] = p[3]; p[3] = j;
      }

      if (smallval != previouscol) {
        this.netindex[previouscol] = (startpos + i) >> 1;
        for (j = previouscol + 1; j < smallval; j++)
          this.netindex[j] = i;
        previouscol = smallval;
        startpos = i;
      }
    }
    this.netindex[previouscol] = (startpos + maxnetpos) >> 1;
    for (j = previouscol + 1; j < 256; j++)
      this.netindex[j] = maxnetpos;
  }

  private inxsearch(b: number, g: number, r: number): number {
    let a: number, p: Float64Array, dist: number;

    let bestd = 1000;
    let best = -1;

    let i = this.netindex[g];
    let j = i - 1;

    while (i < netsize || j >= 0) {
      if (i < netsize) {
        p = this.network[i];
        dist = p[1] - g;
        if (dist >= bestd) i = netsize;
        else {
          i++;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
      if (j >= 0) {
        p = this.network[j];
        dist = g - p[1];
        if (dist >= bestd) j = -1;
        else {
          j--;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
    }

    return best;
  }

  private learn(): void {
    let i: number;

    const lengthcount = this.pixels.length;
    alphadec = 30 + ((this.samplefac - 1) / 3);
    const samplepixels = lengthcount / (3 * this.samplefac);
    let delta = ~~(samplepixels / ncycles);
    let alpha = initalpha;
    let radius = initradius;

    let rad = radius >> radiusbiasshift;

    if (rad <= 1) rad = 0;
    for (i = 0; i < rad; i++)
      this.radpower[i] = alpha * (((rad * rad - i * i) * radbias) / (rad * rad));

    let step: number;
    if (lengthcount < minpicturebytes) {
      this.samplefac = 1;
      step = 3;
    } else if ((lengthcount % prime1) !== 0) {
      step = 3 * prime1;
    } else if ((lengthcount % prime2) !== 0) {
      step = 3 * prime2;
    } else if ((lengthcount % prime3) !== 0) {
      step = 3 * prime3;
    } else {
      step = 3 * prime4;
    }

    let b: number, g: number, r: number, j: number;
    let pix = 0;

    i = 0;
    while (i < samplepixels) {
      b = (this.pixels[pix] & 0xff) << netbiasshift;
      g = (this.pixels[pix + 1] & 0xff) << netbiasshift;
      r = (this.pixels[pix + 2] & 0xff) << netbiasshift;

      j = this.contest(b, g, r);

      this.altersingle(alpha, j, b, g, r);
      if (rad !== 0) this.alterneigh(rad, j, b, g, r);

      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;

      i++;

      if (delta === 0) delta = 1;
      if (i % delta === 0) {
        alpha -= alpha / alphadec;
        radius -= radius / radiusdec;
        rad = radius >> radiusbiasshift;

        if (rad <= 1) rad = 0;
        for (j = 0; j < rad; j++)
          this.radpower[j] = alpha * (((rad * rad - j * j) * radbias) / (rad * rad));
      }
    }
  }

  buildColormap(): void {
    this.init();
    this.learn();
    this.unbiasnet();
    this.inxbuild();
  }

  getColormap(): number[] {
    const map: number[] = [];
    const index: number[] = [];

    for (let i = 0; i < netsize; i++)
      index[this.network[i][3]] = i;

    let k = 0;
    for (let l = 0; l < netsize; l++) {
      const j = index[l];
      map[k++] = this.network[j][0];
      map[k++] = this.network[j][1];
      map[k++] = this.network[j][2];
    }
    return map;
  }

  lookupRGB = (r: number, g: number, b: number): number => {
    return this.inxsearch(b, g, r);
  };
}
