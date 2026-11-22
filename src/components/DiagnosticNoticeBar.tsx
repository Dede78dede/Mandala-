/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Non-blocking Discrete Diagnostic Notice Bar.
 * Subscribes to the structured diagnostics channel and surfaces only
 * user-relevant recoverable warnings/errors deduplicated by DomainErrorCode.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import {
  DiagnosticSeverity,
  type DiagnosticEntry,
  DomainErrorCode,
  getDiagnosticHistory,
  subscribeDiagnostics,
} from '../shared/lib/diagnostics.ts';

interface VisibleNotice {
  readonly id: string;
  readonly code: DomainErrorCode;
  readonly severity: DiagnosticSeverity;
  readonly text: string;
}

const MAX_VISIBLE_NOTICES = 3;

function toVisibleNotice(entry: DiagnosticEntry): VisibleNotice | null {
  if (!entry.userNotice) {
    return null;
  }
  if (entry.severity === DiagnosticSeverity.Info) {
    return null;
  }
  return {
    id: entry.id,
    code: entry.code,
    severity: entry.severity,
    text: entry.userNotice,
  };
}

function upsertNotice(
  prev: readonly VisibleNotice[],
  next: VisibleNotice
): readonly VisibleNotice[] {
  const filtered = prev.filter((item) => item.code !== next.code);
  const updated = [...filtered, next];
  if (updated.length > MAX_VISIBLE_NOTICES) {
    return updated.slice(updated.length - MAX_VISIBLE_NOTICES);
  }
  return updated;
}

export const DiagnosticNoticeBar: React.FC = () => {
  const [notices, setNotices] = useState<readonly VisibleNotice[]>(() => {
    const initial: VisibleNotice[] = [];
    for (const entry of getDiagnosticHistory()) {
      const candidate = toVisibleNotice(entry);
      if (candidate) {
        const merged = upsertNotice(initial, candidate);
        initial.length = 0;
        initial.push(...merged);
      }
    }
    return initial;
  });

  useEffect(() => {
    return subscribeDiagnostics((entry) => {
      const next = toVisibleNotice(entry);
      if (!next) return;
      setNotices((prev) => upsertNotice(prev, next));
    });
  }, []);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col divide-y divide-slate-800 border-b border-slate-800 bg-slate-900/95 z-40"
    >
      {notices.map((notice) => {
        const isError = notice.severity === DiagnosticSeverity.Error;
        return (
          <div
            key={notice.id}
            className={`flex items-center justify-between gap-3 px-4 py-1.5 text-xs ${
              isError ? 'text-rose-200 bg-rose-950/70' : 'text-amber-200 bg-amber-950/60'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isError ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <Info className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="truncate">{notice.text}</span>
            </span>
            <button
              type="button"
              onClick={() =>
                setNotices((prev) => prev.filter((item) => item.code !== notice.code))
              }
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-slate-800/80 transition shrink-0"
              aria-label={`Chiudi notifica diagnostica ${notice.code}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
