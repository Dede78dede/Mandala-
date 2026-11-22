/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier L0 — Contiguous TypedArray Point Buffer (`Float32Array`, stride 3: [x, y, pressure]).
 * Eliminates per-frame JS object allocation during 120Hz–240Hz pointermove capture
 * and pools capacity across strokes without GC churn.
 */

import { MEMORY_TIER_LIMITS } from '../model/constants.ts';
import type { Point } from '../model/types.ts';

export class TypedPointBuffer {
  private buffer: Float32Array;
  private pointCount: number = 0;
  private readonly stride: number = MEMORY_TIER_LIMITS.l0PointStride;
  private readonly initialCapacityPoints: number;

  constructor(initialCapacityPoints: number = MEMORY_TIER_LIMITS.l0InitialCapacityPoints) {
    this.initialCapacityPoints = Math.max(16, initialCapacityPoints);
    this.buffer = new Float32Array(this.initialCapacityPoints * this.stride);
  }

  get length(): number {
    return this.pointCount;
  }

  get capacityPoints(): number {
    return this.buffer.length / this.stride;
  }

  get byteLength(): number {
    return this.buffer.byteLength;
  }

  push(x: number, y: number, pressure: number = 0.5): void {
    const neededFloats = (this.pointCount + 1) * this.stride;
    if (neededFloats > this.buffer.length) {
      const nextCapacityFloats = Math.max(neededFloats, this.buffer.length * 2);
      const next = new Float32Array(nextCapacityFloats);
      next.set(this.buffer);
      this.buffer = next;
    }
    const base = this.pointCount * this.stride;
    this.buffer[base] = x;
    this.buffer[base + 1] = y;
    this.buffer[base + 2] = pressure;
    this.pointCount += 1;
  }

  /**
   * High-frequency input decimation helper: appends point only if moved by at least `minDistSq`.
   */
  pushIfMoved(x: number, y: number, pressure: number = 0.5, minDistSq: number = 1.5): boolean {
    if (this.pointCount > 0) {
      const prevBase = (this.pointCount - 1) * this.stride;
      const dx = x - (this.buffer[prevBase] ?? 0);
      const dy = y - (this.buffer[prevBase + 1] ?? 0);
      if (dx * dx + dy * dy < minDistSq) {
        return false;
      }
    }
    this.push(x, y, pressure);
    return true;
  }

  averagePressure(): number {
    if (this.pointCount === 0) return 0.5;
    let sum = 0;
    for (let i = 0; i < this.pointCount; i++) {
      sum += this.buffer[i * this.stride + 2] ?? 0.5;
    }
    return sum / this.pointCount;
  }

  forEach(visitor: (x: number, y: number, pressure: number, index: number) => void): void {
    for (let i = 0; i < this.pointCount; i++) {
      const base = i * this.stride;
      visitor(
        this.buffer[base] ?? 0,
        this.buffer[base + 1] ?? 0,
        this.buffer[base + 2] ?? 0.5,
        i
      );
    }
  }

  /**
   * Materializes immutable JS Point[] ONLY on stroke commit (or preview snapshot).
   */
  toPoints(): Point[] {
    const out = new Array<Point>(this.pointCount);
    for (let i = 0; i < this.pointCount; i++) {
      const base = i * this.stride;
      out[i] = {
        x: this.buffer[base] ?? 0,
        y: this.buffer[base + 1] ?? 0,
        pressure: this.buffer[base + 2] ?? 0.5,
      };
    }
    return out;
  }

  /**
   * Resets length in O(1) without releasing pooled Float32Array unless exceeding max pooled threshold.
   */
  reset(): void {
    this.pointCount = 0;
    if (this.capacityPoints > MEMORY_TIER_LIMITS.l0MaxPooledPoints) {
      this.buffer = new Float32Array(this.initialCapacityPoints * this.stride);
    }
  }

  /**
   * Hard reclamation of pooled Float32Array backing memory back to initial minimum capacity.
   */
  reclaim(): number {
    const freedBytes = Math.max(
      0,
      this.buffer.byteLength - this.initialCapacityPoints * this.stride * 4
    );
    this.pointCount = 0;
    if (this.capacityPoints > this.initialCapacityPoints) {
      this.buffer = new Float32Array(this.initialCapacityPoints * this.stride);
    }
    return freedBytes;
  }
}
