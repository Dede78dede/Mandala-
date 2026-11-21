/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Accessible Motion Lifecycle & CPU-Aware Playback Gate.
 * - Honors OS `prefers-reduced-motion: reduce`
 * - Pauses continuous rAF loops on `document.visibilitychange` (tab hidden)
 * - Throttles or suspends kinetic playback under `CpuLoadState.Elevated` / `Protected`
 */

import { useEffect, useState } from 'react';
import { CpuLoadState, MotionPauseReason } from '../../features/mandala/model/types.ts';

export interface MotionExecutionGateInput {
  readonly userRequestedPlay: boolean;
  readonly prefersReducedMotion: boolean;
  readonly isPageVisible: boolean;
  readonly cpuLoadState: CpuLoadState;
}

export interface MotionExecutionGate {
  readonly canAnimate: boolean;
  readonly targetFps: number;
  readonly pauseReason: MotionPauseReason | null;
}

/**
 * Pure deterministic gate deciding whether a kinetic rAF loop may run and at what frame cap.
 */
export function evaluateMotionExecutionGate(
  input: MotionExecutionGateInput
): MotionExecutionGate {
  if (!input.userRequestedPlay) {
    return {
      canAnimate: false,
      targetFps: 0,
      pauseReason: MotionPauseReason.PausedByUser,
    };
  }
  if (input.prefersReducedMotion) {
    return {
      canAnimate: false,
      targetFps: 0,
      pauseReason: MotionPauseReason.ReducedMotion,
    };
  }
  if (!input.isPageVisible) {
    return {
      canAnimate: false,
      targetFps: 0,
      pauseReason: MotionPauseReason.TabHidden,
    };
  }
  if (input.cpuLoadState === CpuLoadState.Protected) {
    return {
      canAnimate: false,
      targetFps: 0,
      pauseReason: MotionPauseReason.CpuProtected,
    };
  }

  return {
    canAnimate: true,
    targetFps: input.cpuLoadState === CpuLoadState.Elevated ? 30 : 60,
    pauseReason: null,
  };
}

export function describeMotionPauseReason(reason: MotionPauseReason | null): string | null {
  switch (reason) {
    case MotionPauseReason.ReducedMotion:
      return 'Animazioni automatiche sospese (prefers-reduced-motion attivo).';
    case MotionPauseReason.TabHidden:
      return 'Animazione in pausa automatica (scheda in background).';
    case MotionPauseReason.CpuProtected:
      return 'Animazione sospesa dalla protezione CPU Anti-Saturazione.';
    case MotionPauseReason.PausedByUser:
    default:
      return null;
  }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return isVisible;
}

export function useMotionLifecycle(
  userRequestedPlay: boolean,
  cpuLoadState: CpuLoadState
): MotionExecutionGate & {
  readonly prefersReducedMotion: boolean;
  readonly isPageVisible: boolean;
} {
  const prefersReducedMotion = usePrefersReducedMotion();
  const isPageVisible = usePageVisibility();

  const gate = evaluateMotionExecutionGate({
    userRequestedPlay,
    prefersReducedMotion,
    isPageVisible,
    cpuLoadState,
  });

  return {
    ...gate,
    prefersReducedMotion,
    isPageVisible,
  };
}
