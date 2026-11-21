/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Feature-Sliced Design Public API for `features/mandala` (MANDALA-PH5 §0.4).
 * Keeps heavy/lazy modules (WASM runtime, benchmark suite, WebGL2 pass, ADR archive)
 * excluded from the synchronous barrel so Vite isolates lazy code-split chunks.
 */

export * from './model/constants.ts';
export * from './model/types.ts';
export * from './model/palettes.ts';
export * from './model/schemas.ts';
export * from './model/store.ts';
export * from './strategies/symmetry.ts';
export * from './engine/geometryEngine.ts';
export * from './memory/pointBuffer.ts';
export * from './memory/geometryCache.ts';
export * from './memory/memoryBudget.ts';
export * from './lib/lsystem.ts';
export * from './lib/accessibility.ts';
export * from './lib/canvasRenderer.ts';
export * from './lib/svgExport.ts';
export * from './lib/erasure.ts';
export * from './lib/persistence.ts';
export * from './lib/resourceGuard.ts';
export * from './lib/viewportCamera.ts';
export * from './lib/lensProjection.ts';
export * from './lib/kineticMandala.ts';
export * from './lib/proceduralStamps.ts';
export * from './lib/polarGenerators.ts';
export * from './lib/morphInterpolator.ts';

