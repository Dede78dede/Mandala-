/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mobile-First Bottom Toolbar composed via <MandalaControls> compound components.
 */

import React from 'react';
import { MandalaControls } from './MandalaControls.tsx';

export const BottomToolbar: React.FC = () => {
  return (
    <MandalaControls
      variant="bottom"
      className="fixed bottom-0 left-0 right-0 z-30 px-2.5 sm:px-4 py-1.5 bg-slate-900 border-t border-slate-800 text-slate-100 flex flex-col gap-1.5 shadow-2xl"
    >
      <MandalaControls.StampTray />

      {/* Upper row: Color swatches + mobile symmetry stepper */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-2 py-0.5">
        <MandalaControls.Palette />
        <MandalaControls.Symmetry />
      </div>

      {/* Lower row: Brush/Point/Eraser Tools, Width, Command History */}
      <div className="flex items-center justify-between gap-1 sm:gap-2">
        <MandalaControls.Tools />
        <MandalaControls.History />
      </div>
    </MandalaControls>
  );
};
