// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Pure-JS image processing utilities, shared by image_processing and
// edge_detection. OpenCV-style API: toGray / gaussianBlur / cannyEdges /
// dilate1 / f1Score.

export function toGray(rgba: Uint8ClampedArray, _w: number, _h: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    g[j] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
  }
  return g;
}

function gaussianKernel1D(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(r * 2 + 1);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

export function gaussianBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  sigma: number,
): Uint8ClampedArray {
  if (sigma <= 0.05) return new Uint8ClampedArray(src);
  const k = gaussianKernel1D(sigma);
  const r = (k.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const xi = Math.max(0, Math.min(w - 1, x + i));
        sum += src[y * w + xi] * k[i + r];
      }
      tmp[y * w + x] = sum;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const yi = Math.max(0, Math.min(h - 1, y + i));
        sum += tmp[yi * w + x] * k[i + r];
      }
      out[y * w + x] = sum;
    }
  }
  return out;
}

// Simplified Canny: Sobel + double threshold + light hysteresis (no NMS).
export function cannyEdges(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  low: number,
  high: number,
): Uint8Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1],
        b = gray[i - w],
        c = gray[i - w + 1];
      const d = gray[i - 1],
        e = gray[i + 1];
      const f = gray[i + w - 1],
        gg = gray[i + w],
        hh = gray[i + w + 1];
      const gx = -a + c - 2 * d + 2 * e - f + hh;
      const gy = -a - 2 * b - c + f + 2 * gg + hh;
      mag[i] = Math.hypot(gx, gy);
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mag[i] >= high) out[i] = 2;
    else if (mag[i] >= low) out[i] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (out[i] !== 1) continue;
        if (
          out[i - w - 1] === 2 ||
          out[i - w] === 2 ||
          out[i - w + 1] === 2 ||
          out[i - 1] === 2 ||
          out[i + 1] === 2 ||
          out[i + w - 1] === 2 ||
          out[i + w] === 2 ||
          out[i + w + 1] === 2
        )
          out[i] = 2;
      }
    }
  }
  for (let i = 0; i < w * h; i++) out[i] = out[i] === 2 ? 255 : 0;
  return out;
}

export function dilate1(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) {
        out[i] = 255;
        continue;
      }
      const yu = Math.max(0, y - 1),
        yd = Math.min(h - 1, y + 1);
      const xl = Math.max(0, x - 1),
        xr = Math.min(w - 1, x + 1);
      if (mask[yu * w + x] || mask[yd * w + x] || mask[y * w + xl] || mask[y * w + xr])
        out[i] = 255;
    }
  }
  return out;
}

export function f1Score(detected: Uint8Array, truth: Uint8Array, w: number, h: number): number {
  if (detected.length === 0 || truth.length === 0) return 0;
  const dDil = dilate1(detected, w, h);
  const tDil = dilate1(truth, w, h);
  let tp = 0,
    fp = 0,
    fn = 0;
  for (let i = 0; i < detected.length; i++) {
    const d = detected[i] > 0 ? 1 : 0;
    const t = truth[i] > 0 ? 1 : 0;
    const dInTruth = d && tDil[i] > 0;
    const tInDetected = t && dDil[i] > 0;
    if (d && tInDetected) tp++;
    else if (d && !dInTruth) fp++;
    if (t && !tInDetected) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}
