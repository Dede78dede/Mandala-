/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';

export type ControlsVariant = 'topbar' | 'bottom' | 'sheet';

export const MandalaControlsContext = createContext<{ variant: ControlsVariant }>({
  variant: 'topbar',
});

export function useControlsVariant(): ControlsVariant {
  return useContext(MandalaControlsContext).variant;
}
