// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

export type BaseballContact = "homer" | "hit" | "foul" | "miss";

export interface BaseballSwingResult {
  contact: BaseballContact;
  quality: number;
}

export function classifyBaseballSwing(
  pitchProgress: number,
  aimError: number,
  perfectTime = 0.9,
): BaseballSwingResult {
  if (pitchProgress < 0.77 || pitchProgress > 1.01 || aimError > 62) {
    return { contact: "miss", quality: 0 };
  }
  const timingError = Math.abs(pitchProgress - perfectTime);
  const timingQuality = Math.max(0, 1 - timingError / 0.15);
  const aimQuality = Math.max(0, 1 - aimError / 58);
  const quality = timingQuality * 0.58 + aimQuality * 0.42;
  return {
    contact: quality >= 0.82 ? "homer" : quality >= 0.48 ? "hit" : "foul",
    quality,
  };
}

export function baseballStars(score: number): 1 | 2 | 3 {
  return score >= 6500 ? 3 : score >= 3500 ? 2 : 1;
}
