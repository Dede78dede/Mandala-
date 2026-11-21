/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mandala Studio — Interactive Creation Workspace with Dynamic Lazy-Loaded Modals,
 * Non-Blocking Persistence Flush, and Anti-Saturation / Cache Maintenance Banners.
 */

import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2, X } from 'lucide-react';
import { flushPendingPersistence } from './features/mandala/lib/persistence.ts';
import { useMandalaStore } from './features/mandala/model/store.ts';
import { MandalaCanvas } from './components/MandalaCanvas.tsx';
import { TopBar } from './components/TopBar.tsx';
import { BottomToolbar } from './components/BottomToolbar.tsx';
import { OfflineIndicator } from './shared/pwa/PWAInstallButton.tsx';
import { PWAUpdateBanner } from './shared/pwa/PWAUpdateBanner.tsx';

const loadMobileOptionsSheet = () =>
  import('./components/MobileOptionsSheet.tsx').then((m) => ({ default: m.MobileOptionsSheet }));
const loadAndroidAnalysisHub = () =>
  import('./components/AndroidAnalysisHub.tsx').then((m) => ({ default: m.AndroidAnalysisHub }));
const loadLSystemModal = () =>
  import('./components/LSystemModal.tsx').then((m) => ({ default: m.LSystemModal }));
const loadExportModal = () =>
  import('./components/ExportModal.tsx').then((m) => ({ default: m.ExportModal }));

const MobileOptionsSheet = lazy(loadMobileOptionsSheet);
const AndroidAnalysisHub = lazy(loadAndroidAnalysisHub);
const LSystemModal = lazy(loadLSystemModal);
const ExportModal = lazy(loadExportModal);

export default function App() {
  const wedgesCount = useMandalaStore((s) => s.wedges.length);
  const canUndo = useMandalaStore((s) => s.undoStack.length > 0);
  const canRedo = useMandalaStore((s) => s.redoStack.length > 0);
  const liveAnnouncement = useMandalaStore((s) => s.liveAnnouncement);
  const persistenceWarning = useMandalaStore((s) => s.persistenceWarning);
  const guardAlert = useMandalaStore((s) => s.guardAlert);
  const lastMaintenanceMessage = useMandalaStore((s) => s.lastMaintenanceMessage);
  const dismissPersistenceWarning = useMandalaStore((s) => s.dismissPersistenceWarning);
  const dismissGuardAlert = useMandalaStore((s) => s.dismissGuardAlert);
  const dismissMaintenanceMessage = useMandalaStore((s) => s.dismissMaintenanceMessage);
  const undo = useMandalaStore((s) => s.undo);
  const redo = useMandalaStore((s) => s.redo);

  const [isAndroidHubOpen, setIsAndroidHubOpen] = useState<boolean>(false);
  const [isFractalModalOpen, setIsFractalModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isMobileOptionsOpen, setIsMobileOptionsOpen] = useState<boolean>(false);

  const handlePrefetchModal = useCallback(
    (modal: 'fractal' | 'export' | 'hub' | 'mobile') => {
      if (modal === 'fractal') void loadLSystemModal();
      else if (modal === 'export') void loadExportModal();
      else if (modal === 'hub') void loadAndroidAnalysisHub();
      else if (modal === 'mobile') void loadMobileOptionsSheet();
    },
    []
  );

  // Flush debounced persistence safely when page hides/unloads
  useEffect(() => {
    const handlePageHide = () => {
      flushPendingPersistence();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  // Global Keyboard Shortcuts (Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (canRedo) redo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  // Auto-dismiss transient maintenance toast after 4.5s
  useEffect(() => {
    if (!lastMaintenanceMessage) return;
    const timer = setTimeout(() => dismissMaintenanceMessage(), 4500);
    return () => clearTimeout(timer);
  }, [lastMaintenanceMessage, dismissMaintenanceMessage]);

  return (
    <div className="flex flex-col w-full max-w-full h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* Accessible Debounced Live Region (MANDALA-PH4 §3.2.B) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        id="mandala-live-announcer"
      >
        {liveAnnouncement}
      </div>

      <OfflineIndicator />
      <PWAUpdateBanner />

      {persistenceWarning && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-950/90 border-b border-amber-800 text-xs text-amber-200 z-40"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            Sessione precedente incompatibile ({persistenceWarning}). Avviata nuova tela sicura.
          </span>
          <button
            type="button"
            onClick={dismissPersistenceWarning}
            className="p-1 hover:bg-amber-900/50 rounded"
            aria-label="Chiudi avviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {guardAlert && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-rose-950/90 border-b border-rose-800 text-xs text-rose-200 z-40"
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{guardAlert}</span>
          </span>
          <button
            type="button"
            onClick={dismissGuardAlert}
            className="p-1 hover:bg-rose-900/50 rounded shrink-0"
            aria-label="Chiudi avviso sicurezza"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {lastMaintenanceMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-cyan-950/90 border-b border-cyan-800 text-xs text-cyan-200 z-40"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{lastMaintenanceMessage}</span>
          </span>
          <button
            type="button"
            onClick={dismissMaintenanceMessage}
            className="p-1 hover:bg-cyan-900/50 rounded shrink-0"
            aria-label="Chiudi notifica manutenzione"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Bar */}
      <TopBar
        onOpenExport={() => setIsExportModalOpen(true)}
        onOpenAndroidHub={() => setIsAndroidHubOpen(true)}
        onOpenFractalModal={() => setIsFractalModalOpen(true)}
        onOpenMobileOptions={() => setIsMobileOptionsOpen(true)}
        onPrefetchModal={handlePrefetchModal}
      />

      {/* Main Interactive Workspace */}
      <main className="relative flex-1 w-full h-full flex items-center justify-center pb-24 md:pb-20 overflow-hidden">
        <MandalaCanvas />

        {wedgesCount === 0 && (
          <p className="hidden sm:block absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-20 text-xs text-slate-400 tracking-wide whitespace-nowrap">
            Trascina sullo schermo o usa le frecce per disegnare il mandala
          </p>
        )}
      </main>

      {/* Mobile-first Thumb-Zone Bottom Toolbar */}
      <BottomToolbar />

      {/* Dynamic Lazy-Loaded Secondary Surfaces (Code-Split Off Initial Paint) */}
      <Suspense fallback={null}>
        {isMobileOptionsOpen && (
          <MobileOptionsSheet
            isOpen={isMobileOptionsOpen}
            onClose={() => setIsMobileOptionsOpen(false)}
            onOpenFractalModal={() => setIsFractalModalOpen(true)}
            onOpenExport={() => setIsExportModalOpen(true)}
            onOpenAndroidHub={() => setIsAndroidHubOpen(true)}
            onPrefetchModal={handlePrefetchModal}
          />
        )}

        {isAndroidHubOpen && (
          <AndroidAnalysisHub
            isOpen={isAndroidHubOpen}
            onClose={() => setIsAndroidHubOpen(false)}
          />
        )}

        {isFractalModalOpen && (
          <LSystemModal
            isOpen={isFractalModalOpen}
            onClose={() => setIsFractalModalOpen(false)}
          />
        )}

        {isExportModalOpen && (
          <ExportModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
