/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Isolated Web Audio Haptic Feedback Service.
 * Automatically closes ephemeral AudioContext nodes after playback to avoid resource leaks.
 */

import { HapticTone } from '../../features/mandala/model/types.ts';

export function playHapticTone(enabled: boolean, tone: HapticTone): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
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
      void ctx.close().catch(() => undefined);
    };
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    // Autoplay policy may block audio before first user gesture
  }
}
