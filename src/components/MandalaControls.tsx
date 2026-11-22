/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compound Component Control Panel Barrel (MANDALA-PH2 Task 2.2.C & PH6 §11).
 * Sub-components are modularized under `./controls/`.
 */

import React, { memo } from 'react';
import {
  MandalaControlsContext,
  type ControlsVariant,
} from './controls/controlsContext.ts';
import {
  StrategyControl,
  StrategyParamsControl,
  SymmetryControl,
} from './controls/SymmetryStrategyPanel.tsx';
import {
  EnvironmentTogglesControl,
  HistoryControl,
  PaletteControl,
  StrokeStyleControl,
  ToolsControl,
} from './controls/StrokePaletteControls.tsx';
import { StampTrayControl } from './controls/StampTrayControls.tsx';

interface MandalaControlsRootProps {
  variant?: ControlsVariant;
  children: React.ReactNode;
  className?: string;
}

const MandalaControlsRoot: React.FC<MandalaControlsRootProps> = ({
  variant = 'topbar',
  children,
  className = '',
}) => {
  return (
    <MandalaControlsContext.Provider value={{ variant }}>
      <div className={className}>{children}</div>
    </MandalaControlsContext.Provider>
  );
};

export const MandalaControls = Object.assign(MandalaControlsRoot, {
  Symmetry: memo(SymmetryControl),
  Strategy: memo(StrategyControl),
  StrategyParams: memo(StrategyParamsControl),
  StrokeStyle: memo(StrokeStyleControl),
  Palette: memo(PaletteControl),
  Tools: memo(ToolsControl),
  StampTray: memo(StampTrayControl),
  History: memo(HistoryControl),
  Environment: memo(EnvironmentTogglesControl),
});
