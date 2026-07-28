// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Particle system. Wraps the Particle[] + update + draw + spawnBurst trio
// so stages don't have to declare and pass the array around. Internally
// delegates to the existing primitives in lib/draw.ts to keep behavior
// byte-identical.

import type { Particle } from "../types";
import { updateParticles, drawParticles, spawnBurst as spawnBurstPrim } from "./draw";

export class Particles {
  private list: Particle[] = [];

  update(dt: number): void {
    updateParticles(this.list, dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawParticles(ctx, this.list);
  }

  burst(x: number, y: number, color: string, count = 28, speed = 220): void {
    spawnBurstPrim(this.list, x, y, color, count, speed);
  }

  /** Append a hand-built Particle (e.g. for stages that need bespoke physics). */
  push(p: Particle): void {
    this.list.push(p);
  }

  reset(): void {
    this.list.length = 0;
  }

  get count(): number {
    return this.list.length;
  }
}
