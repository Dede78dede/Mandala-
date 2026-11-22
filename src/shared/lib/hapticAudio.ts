/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Isolated Web Audio Haptic Feedback Service.
 * Uses a lazy shared AudioContext with idle auto-reclamation + Flush Cache hook
 * and structured diagnostics on autoplay/policy blocks.
 */

import { HapticTone } from '../../features/mandala/model/types.ts';
import { registerBufferReclaimer } from './cacheService.ts';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from './diagnostics.ts';

const IDLE_CLOSE_TIMEOUT_MS = 10_000;

let sharedAudioCtx: AudioContext | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let hasLoggedAudioBlock = false;

export function closeSharedAudioContext(): void {
  if (idleCloseTimer !== null) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  if (sharedAudioCtx) {
    const ctxToClose = sharedAudioCtx;
    sharedAudioCtx = null;
    if (ctxToClose.state !== 'closed') {
      void ctxToClose.close().catch(() => undefined);
    }
  }
}

registerBufferReclaimer(() => {
  closeSharedAudioContext();
  return 0;
});

function scheduleIdleClose(): void {
  if (idleCloseTimer !== null) {
    clearTimeout(idleCloseTimer);
  }
  idleCloseTimer = setTimeout(() => {
    closeSharedAudioContext();
  }, IDLE_CLOSE_TIMEOUT_MS);
}

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    return sharedAudioCtx;
  }
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

export function playHapticTone(enabled: boolean, tone: HapticTone): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch((cause) => {
        if (!hasLoggedAudioBlock) {
          hasLoggedAudioBlock = true;
          reportDiagnostic({
            severity: DiagnosticSeverity.Info,
            source: DiagnosticSource.Audio,
            code: DomainErrorCode.AudioBlocked,
            message: 'Ripresa AudioContext bloccata dalla policy autoplay.',
            cause,
          });
        }
      });
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const durationSec = tone === HapticTone.Click ? 0.05 : 0.35;

    if (tone === HapticTone.Click) {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + durationSec);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Nodes already disconnected
      }
      scheduleIdleClose();
    };
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
    scheduleIdleClose();
  } catch (cause) {
    if (!hasLoggedAudioBlock) {
      hasLoggedAudioBlock = true;
      reportDiagnostic({
        severity: DiagnosticSeverity.Info,
        source: DiagnosticSource.Audio,
        code: DomainErrorCode.AudioBlocked,
        message: 'Audio feedback non disponibile o bloccato dal browser.',
        cause,
      });
    }
  }
}
