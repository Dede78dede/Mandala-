/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 Core Type Discipline:
 * - Result<T, E> discriminated union for recoverable failures (MANDALA-PH6 §2.4)
 * - assertNever() exhaustiveness check for discriminated unions (MANDALA-PH6 §2.2)
 * - OperationState<T> discriminated union for async/export states (MANDALA-PH6 §2.1)
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminated union variant: ${JSON.stringify(x)}`);
}

export enum OperationStatus {
  Idle = 'idle',
  Pending = 'pending',
  Success = 'success',
  Error = 'error',
}

export type OperationState<T, E = string> =
  | { status: OperationStatus.Idle }
  | { status: OperationStatus.Pending }
  | { status: OperationStatus.Success; data: T }
  | { status: OperationStatus.Error; error: E };
