/** Little binary writer / reader for snapshots and inputs (growing buffer, little-endian). */
const enc = new TextEncoder(), dec = new TextDecoder();

export class Writer {
  private buf = new ArrayBuffer(4096);
  private dv = new DataView(this.buf);
  private u8 = new Uint8Array(this.buf);
  n = 0;
  reset() { this.n = 0; return this; }
  private need(k: number) {
    if (this.n + k <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2; while (size < this.n + k) size *= 2;
    const nb = new ArrayBuffer(size); new Uint8Array(nb).set(this.u8.subarray(0, this.n));
    this.buf = nb; this.dv = new DataView(nb); this.u8 = new Uint8Array(nb);
  }
  u8w(v: number) { this.need(1); this.dv.setUint8(this.n, v); this.n += 1; return this; }
  i8(v: number) { this.need(1); this.dv.setInt8(this.n, Math.max(-128, Math.min(127, Math.round(v)))); this.n += 1; return this; }
  u16(v: number) { this.need(2); this.dv.setUint16(this.n, v, true); this.n += 2; return this; }
  i16(v: number) { this.need(2); this.dv.setInt16(this.n, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.n += 2; return this; }
  u32(v: number) { this.need(4); this.dv.setUint32(this.n, v >>> 0, true); this.n += 4; return this; }
  f32(v: number) { this.need(4); this.dv.setFloat32(this.n, v, true); this.n += 4; return this; }
  f64(v: number) { this.need(8); this.dv.setFloat64(this.n, v, true); this.n += 8; return this; }
  str(s: string) {
    const b = enc.encode(s);
    if (b.length < 255) this.u8w(b.length); else { this.u8w(255); this.u32(b.length); }
    this.need(b.length); this.u8.set(b, this.n); this.n += b.length; return this;
  }
  /** Copy of the written bytes, with `head` free bytes in front (relay header). */
  bytes(head = 0) { const out = new Uint8Array(this.n + head); out.set(this.u8.subarray(0, this.n), head); return out; }
}

export class Reader {
  private dv: DataView; n: number;
  constructor(private u8: Uint8Array, start = 0) { this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.n = start; }
  get left() { return this.u8.byteLength - this.n; }
  u8r() { return this.dv.getUint8(this.n++); }
  i8() { return this.dv.getInt8(this.n++); }
  u16() { const v = this.dv.getUint16(this.n, true); this.n += 2; return v; }
  i16() { const v = this.dv.getInt16(this.n, true); this.n += 2; return v; }
  u32() { const v = this.dv.getUint32(this.n, true); this.n += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.n, true); this.n += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.n, true); this.n += 8; return v; }
  str() {
    let len = this.u8r(); if (len === 255) len = this.u32();
    const s = dec.decode(this.u8.subarray(this.n, this.n + len)); this.n += len; return s;
  }
}
