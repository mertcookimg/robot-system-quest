// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Shared type definitions used by both the runtime shell (src/main.ts +
// src/core) and every stage in src/stages.

import type { SfxBank } from "./core/audio";

/** Game canvas pixel dimensions. */
export const W = 800;
export const H = 500;

export interface GhostPose {
  x: number;
  y: number;
  theta: number;
}

export interface GhostApi {
  /** Begin a fresh pose recording (called from stage reset). */
  startRecording(): void;
  /** Record a pose. Internally rate-limited; safe to call every frame. */
  recordPose(t: number, x: number, y: number, theta: number): void;
  /** Linearly interpolated pose at time t, or undefined if no replay. */
  getPose(t: number): GhostPose | undefined;
  /** True if a replay is loaded and the user has the ghost toggle on. */
  hasReplay(): boolean;
  /** Draw the replay sprite at time t (no-op if no replay loaded). */
  draw(ctx: CanvasRenderingContext2D, t: number, animTime: number): void;
}

export interface GameContext {
  // === Runtime IO ===
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Union of keyboard- and gamepad-held keys. Read-only for stages. */
  keys: ReadonlySet<string>;
  /** Stage-controlled DOM panel for ad-hoc HTML (sliders, block editor, ...). */
  overlay: HTMLElement;

  // === UI feedback ===
  setStatus(text: string, color?: string): void;
  setHud(lines: string[]): void;
  /** Show the stage clear overlay. statsHtml may include "Time <b>X.XX s</b>". */
  showClear(stars: number, statsHtml: string): void;
  /**
   * Convenience wrapper around showClear: plays the clear sfx and fires
   * showClear after a short delay so the in-stage celebration animation
   * has time to play. Returns nothing — the stage should still set its
   * own `cleared` flag before calling this so update() short-circuits.
   *
   *   g.awardStars(3, `Time <b>${t.toFixed(2)} s</b>`);
   */
  awardStars(stars: number, statsHtml: string, delayMs?: number): void;
  /** Schedule work that is automatically cancelled when the stage changes. */
  setTimeout(callback: () => void, delayMs: number): void;
  /** Trigger the canvas shake animation. intensity is currently unused. */
  shake(intensity?: number): void;
  /** Trigger the crash overlay; reset() runs once it fades out. */
  crash(reason?: string): void;

  // === ROS topic monitor ===
  publish(topic: string, msg: string): void;

  // === Audio ===
  sfx: SfxBank;

  // === Replay ===
  ghost: GhostApi;

  /** Best time for the given stage (defaults to the current stage). */
  getBestTime(stageId?: string): number | undefined;
}

export interface StageMeta {
  id: string;
  name: string;
  lesson: string;
  lessonCmd: string;
  /** Concepts and graph state used by the in-browser learning terminal. */
  ros2?: Ros2Concept;
}

export interface Ros2Concept {
  /** Concept name (e.g. "Pub-Sub", "Subscribe", "Service Call"). */
  title: string;
  /** 1-2 sentences: what the user learns and why it matters in ROS 2. */
  summary: string;
  /** Related ROS 2 message types (e.g. ["geometry_msgs/msg/Twist"]). */
  msgTypes: string[];
  /** Candidate commands; the UI exposes only safe in-game observations. */
  cli: string[];
  /** Optional author reference retained in stage data; not shown in the game UI. */
  python?: string;
  /** Author background retained in stage data; not shown in the game UI. */
  realWorld: string;
  /** Pseudo-terminal state: live nodes / topics / services for the stage. */
  state?: Ros2State;
}

export interface Ros2State {
  nodes: string[];
  topics: TopicInfo[];
  services?: ServiceInfo[];
}

export interface TopicInfo {
  name: string;
  type: string;
  pub?: string[];
  sub?: string[];
}

export interface ServiceInfo {
  name: string;
  type: string;
  node?: string;
}

export interface Stage extends StageMeta {
  init(ctx: GameContext): void;
  update(dt: number): void;
  draw(): void;
  reset(): void;
  dispose(): void;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  color: string;
  size: number;
}
