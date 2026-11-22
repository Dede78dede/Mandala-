/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Root React ErrorBoundary providing crash containment and safe session recovery.
 */

import React from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../shared/lib/diagnostics.ts';
import { clearSavedSessionStorage } from '../features/mandala/lib/persistence.ts';

interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Errore imprevisto di rendering.',
    };
  }

  private readonly handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  private readonly handleSafeReset = () => {
    const cleanCachesAndSw = async () => {
      await clearSavedSessionStorage().catch((e) => {
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.Storage,
          code: DomainErrorCode.StorageWriteFailed,
          message: 'Pulizia sessione durante recovery non completata.',
          cause: e,
        });
      });
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((k) => window.caches.delete(k)));
        } catch (e) {
          reportDiagnostic({
            severity: DiagnosticSeverity.Info,
            source: DiagnosticSource.Storage,
            code: DomainErrorCode.StorageAccessDenied,
            message: 'Rimozione cache browser non permessa in questo contesto.',
            cause: e,
          });
        }
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        } catch (e) {
          reportDiagnostic({
            severity: DiagnosticSeverity.Info,
            source: DiagnosticSource.Storage,
            code: DomainErrorCode.StorageAccessDenied,
            message: 'Deregistrazione Service Worker saltata.',
            cause: e,
          });
        }
      }
    };

    void cleanCachesAndSw().finally(() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });
  };

  public override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center min-h-screen w-full bg-slate-950 text-slate-100 p-6 font-sans"
      >
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">
                Ripristino Workspace Mandala
              </h1>
              <p className="text-xs text-slate-400">
                Si è verificato un arresto imprevisto del motore grafico.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <p className="text-xs font-mono text-rose-300 bg-slate-950 border border-slate-800 rounded-xl p-3 break-words">
              {this.state.errorMessage}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Riprova</span>
            </button>
            <button
              type="button"
              onClick={this.handleSafeReset}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Reset Sessione Sicura</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
