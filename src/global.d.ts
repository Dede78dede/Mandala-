/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed browser ambient augmentations eliminating unsafe casts.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Navigator {
    readonly standalone?: boolean;
  }

  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  interface PerformanceMemoryInfo {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  }

  interface Performance {
    readonly memory?: PerformanceMemoryInfo;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}
