/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlled Service Worker Update Hook (MANDALA-PH4 Task 4.2.D & PH5 §3.2.B).
 * Prevents unrequested mid-session reloads by gating SKIP_WAITING behind user confirmation
 * and guarding `controllerchange` with a single-reload flag.
 */

import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface ServiceWorkerUpdateState {
  readonly needRefresh: boolean;
  readonly offlineReady: boolean;
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [needRefresh, setNeedRefresh] = useState<boolean>(false);
  const [offlineReady, setOfflineReady] = useState<boolean>(false);
  const updateFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const updateRequestedRef = useRef<boolean>(false);
  const reloadingRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const triggerSingleReload = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    const handleControllerChange = () => {
      if (!updateRequestedRef.current) return;
      triggerSingleReload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    let cancelled = false;
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const startRegistration = () => {
      if (cancelled) return;
      try {
        updateFnRef.current = registerSW({
          immediate: true,
          onNeedRefresh() {
            setNeedRefresh(true);
          },
          onNeedReload() {
            if (updateRequestedRef.current) {
              triggerSingleReload();
            }
          },
          onOfflineReady() {
            setOfflineReady(true);
          },
        });
      } catch {
        // Safe no-op in non-SW test or sandboxed contexts
      }
    };

    const scheduleRegistration = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(startRegistration, { timeout: 600 });
      } else {
        timerId = setTimeout(startRegistration, 120);
      }
    };

    if (document.readyState === 'complete') {
      scheduleRegistration();
    } else {
      window.addEventListener('load', scheduleRegistration, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('load', scheduleRegistration);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const applyUpdate = async () => {
    setNeedRefresh(false);
    updateRequestedRef.current = true;
    if (updateFnRef.current) {
      await updateFnRef.current(true);
    }
    setTimeout(() => {
      if (!reloadingRef.current) {
        reloadingRef.current = true;
        window.location.reload();
      }
    }, 1500);
  };

  const dismissUpdate = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return {
    needRefresh,
    offlineReady,
    applyUpdate,
    dismissUpdate,
  };
}
