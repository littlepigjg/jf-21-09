/*
  LZWEncoder.js

  Authors
  Kevin Weiner (original Java version - kweiner@fmsware.com)
  Thibault Imbert (AS3 version - bytearray.org)
  Johan Nordberg (JS version - code@johan-nordberg.com)
*/

const EOF = -1;
const BITS = 12;
const HSIZE = 5003;
const masks = [0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F,
  0x003F, 0x007F, 0x00FF, 0x01FF, 0x03FF, 0x07FF,
  0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF];

interface OutputStream {
  writeByte(val: number): void;
  writeBytes(array: Uint8Array, offset?: number, length?: number): void;
}

export class LZWEncoder {
  private initCodeSize: number;
  private accum: Uint8Array;
  private htab: Int32Array;
  private codetab: Int32Array;
  private cur_accum = 0;
  private cur_bits = 0;
  private a_count = 0;
  private free_ent = 0;
  private maxcode = 0;
  private clear_flg = false;
  private g_init_bits = 0;
  private ClearCode = 0;
  private EOFCode = 0;
  private n_bits = 0;
  private remaining = 0;
  private curPixel = 0;

  constructor(
    private width: number,
    private height: number,
    private pixels: Uint8Array,
    colorDepth: number
  ) {
    this.initCodeSize = Math.max(2, colorDepth);
    this.accum = new Uint8Array(256);
    this.htab = new Int32Array(HSIZE);
    this.codetab = new Int32Array(HSIZE);
  }

  private char_out(c: number, outs: OutputStream): void {
    this.accum[this.a_count++] = c;
    if (this.a_count >= 254) this.flush_char(outs);
  }

  private cl_block(outs: OutputStream): void {
    this.cl_hash(HSIZE);
    this.free_ent = this.ClearCode + 2;
    this.clear_flg = true;
    this.output(this.ClearCode, outs);
  }

  private cl_hash(hsize: number): void {
    for (let i = 0; i < hsize; ++i) this.htab[i] = -1;
  }

  private MAXCODE(n_bits: number): number {
    return (1 << n_bits) - 1;
  }

  private nextPixel(): number {
    if (this.remaining === 0) return EOF;
    --this.remaining;
    const pix = this.pixels[this.curPixel++];
    return pix & 0xff;
  }

  private compress(init_bits: number, outs: OutputStream): void {
    let fcode: number, c: number, i: number, ent: number, disp: number, hsize_reg: number, hshift: number;

    this.g_init_bits = init_bits;

    this.clear_flg = false;
    this.n_bits = this.g_init_bits;
    this.maxcode = this.MAXCODE(this.n_bits);

    this.ClearCode = 1 << (init_bits - 1);
    this.EOFCode = this.ClearCode + 1;
    this.free_ent = this.ClearCode + 2;

    this.a_count = 0;

    ent = this.nextPixel();

    hshift = 0;
    for (fcode = HSIZE; fcode < 65536; fcode *= 2) ++hshift;
    hshift = 8 - hshift;
    hsize_reg = HSIZE;
    this.cl_hash(hsize_reg);

    this.output(this.ClearCode, outs);

    outer_loop: while ((c = this.nextPixel()) != EOF) {
      fcode = (c << BITS) + ent;
      i = (c << hshift) ^ ent;
      if (this.htab[i] === fcode) {
        ent = this.codetab[i];
        continue;
      } else if (this.htab[i] >= 0) {
        disp = hsize_reg - i;
        if (i === 0) disp = 1;
        do {
          if ((i -= disp) < 0) i += hsize_reg;
          if (this.htab[i] === fcode) {
            ent = this.codetab[i];
            continue outer_loop;
          }
        } while (this.htab[i] >= 0);
      }
      this.output(ent, outs);
      ent = c;
      if (this.free_ent < 1 << BITS) {
        this.codetab[i] = this.free_ent++;
        this.htab[i] = fcode;
      } else {
        this.cl_block(outs);
      }
    }

    this.output(ent, outs);
    this.output(this.EOFCode, outs);
  }

  encode(outs: OutputStream): void {
    outs.writeByte(this.initCodeSize);
    this.remaining = this.width * this.height;
    this.curPixel = 0;
    this.compress(this.initCodeSize + 1, outs);
    outs.writeByte(0);
  }

  private flush_char(outs: OutputStream): void {
    if (this.a_count > 0) {
      outs.writeByte(this.a_count);
      outs.writeBytes(this.accum, 0, this.a_count);
      this.a_count = 0;
    }
  }

  private output(code: number, outs: OutputStream): void {
    this.cur_accum &= masks[this.cur_bits];

    if (this.cur_bits > 0) this.cur_accum |= (code << this.cur_bits);
    else this.cur_accum = code;

    this.cur_bits += this.n_bits;

    while (this.cur_bits >= 8) {
      this.char_out((this.cur_accum & 0xff), outs);
      this.cur_accum >>= 8;
      this.cur_bits -= 8;
    }

    if (this.free_ent > this.maxcode || this.clear_flg) {
      if (this.clear_flg) {
        this.maxcode = this.MAXCODE(this.n_bits = this.g_init_bits);
        this.clear_flg = false;
      } else {
        ++this.n_bits;
        if (this.n_bits == BITS) this.maxcode = 1 << BITS;
        else this.maxcode = this.MAXCODE(this.n_bits);
      }
    }

    if (code == this.EOFCode) {
      while (this.cur_bits > 0) {
        this.char_out((this.cur_accum & 0xff), outs);
        this.cur_accum >>= 8;
        this.cur_bits -= 8;
      }
      this.flush_char(outs);
    }
  }
}
