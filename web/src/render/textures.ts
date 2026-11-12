import * as THREE from 'three';
import { fbm, Rng } from '../core/util';

/** Procedural tiling textures painted on a canvas (no files needed). */
function canvasTex(size: number, paint: (ctx: CanvasRenderingContext2D, img: ImageData) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  paint(ctx, img);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Tileable fbm: sample on a torus. */
function tileNoise(x: number, y: number, size: number, scale: number, oct = 4) {
  const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
  const r = scale / (Math.PI * 2);
  return fbm(Math.cos(a) * r + 40 + Math.cos(b) * r * 0.37, Math.sin(a) * r + Math.sin(b) * r + 11, oct);
}

export function grassTexture() {
  return canvasTex(512, (ctx, img) => {
    const d = img.data, n = 512;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = tileNoise(x, y, n, 9), w = tileNoise(x, y, n, 40, 2);
      const i = (y * n + x) * 4;
      d[i] = 92 + v * 26 + w * 18; d[i + 1] = 158 + v * 30 + w * 14; d[i + 2] = 58 + v * 14;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const r = new Rng(7);
    for (let k = 0; k < 9000; k++) { // blade strokes
      const x = r.range(0, n), y = r.range(0, n), l = r.range(3, 9);
      const g = r.range(0, 1);
      ctx.strokeStyle = `rgba(${100 + g * 50},${165 + g * 40},${62 + g * 20},${r.range(0.2, 0.4)})`;
      ctx.lineWidth = r.range(0.8, 1.6);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r.range(-2, 2), y - l); ctx.stroke();
    }
  });
}

export function dirtTexture() {
  return canvasTex(512, (ctx, img) => {
    const d = img.data, n = 512;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = tileNoise(x, y, n, 14), w = tileNoise(x, y, n, 60, 2);
      const i = (y * n + x) * 4;
      d[i] = 196 + v * 30 - w * 16; d[i + 1] = 146 + v * 24 - w * 12; d[i + 2] = 92 + v * 16 - w * 8; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const r = new Rng(3);
    for (let k = 0; k < 700; k++) { // pebbles
      const x = r.range(0, n), y = r.range(0, n), s = r.range(1.5, 4.5), g = r.range(110, 190);
      ctx.fillStyle = `rgba(${g},${g * 0.92},${g * 0.82},0.85)`;
      ctx.beginPath(); ctx.ellipse(x, y, s, s * r.range(0.6, 1), r.range(0, 3), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(40,25,10,0.35)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.2, s, s * 0.6, 0, 0, Math.PI); ctx.fill();
    }
  });
}

export function mudTexture() {
  return canvasTex(256, (ctx, img) => {
    const d = img.data, n = 256;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = tileNoise(x, y, n, 10), w = tileNoise(x, y, n, 28, 3);
      const i = (y * n + x) * 4;
      d[i] = 104 + v * 26 + w * 14; d[i + 1] = 66 + v * 18 + w * 8; d[i + 2] = 38 + v * 10; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Soft round sprite for particles (white, alpha falloff). */
export function softDot(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
