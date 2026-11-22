/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Kotlin 2.1 + Rust/WASM Scaffold Viewer & Exporter Tab.
 */

import React from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { AndroidScaffoldFile } from '../../features/mandala/model/androidScaffoldTemplates.ts';

interface ScaffoldTabProps {
  readonly files: readonly AndroidScaffoldFile[];
  readonly selectedIdx: number;
  readonly copiedPath: string | null;
  readonly onSelectIdx: (idx: number) => void;
  readonly onCopyFile: (path: string, content: string) => void;
  readonly onDownloadFile: (path: string, content: string) => void;
}

export const ScaffoldTab: React.FC<ScaffoldTabProps> = ({
  files,
  selectedIdx,
  copiedPath,
  onSelectIdx,
  onCopyFile,
  onDownloadFile,
}) => {
  const activeFile = files[selectedIdx] ?? files[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {files.map((file, idx) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelectIdx(idx)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
              selectedIdx === idx
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {file.path.split('/').pop()}
          </button>
        ))}
      </div>

      {activeFile && (
        <>
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl text-xs">
            <div>
              <span className="font-semibold text-white">{activeFile.title}</span>
              <span className="text-slate-400 ml-2 font-mono text-[11px]">{activeFile.path}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onCopyFile(activeFile.path, activeFile.content)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
              >
                {copiedPath === activeFile.path ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedPath === activeFile.path ? 'Copiato' : 'Copia'}</span>
              </button>
              <button
                type="button"
                onClick={() => onDownloadFile(activeFile.path, activeFile.content)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Scarica</span>
              </button>
            </div>
          </div>

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto max-h-[46vh] leading-relaxed">
            {activeFile.content}
          </pre>
        </>
      )}
    </div>
  );
};
