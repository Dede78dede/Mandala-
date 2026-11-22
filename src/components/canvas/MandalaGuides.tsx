/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Layer 3 SVG Adaptive Symmetry Guides locked to CameraTransform viewBox.
 */

import React, { memo, useMemo } from 'react';
import {
  CANVAS_THEME,
  LOGICAL_CENTER,
  WORLD_SPACE_LIMITS,
} from '../../features/mandala/model/constants.ts';
import type { CameraTransform } from '../../features/mandala/model/types.ts';
import { screenToWorldPoint } from '../../features/mandala/lib/viewportCamera.ts';

interface MandalaGuidesProps {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly displaySize: number;
  readonly camera: CameraTransform;
  readonly worldRadius: number;
  readonly order: number;
}

const EXTENDED_RING_STEPS: ReadonlyArray<number> = [600, 800, 1000, 1200];

export const MandalaGuides: React.FC<MandalaGuidesProps> = memo(
  ({ viewportWidth, viewportHeight, displaySize, camera, worldRadius, order }) => {
    const viewBoxInfo = useMemo(() => {
      const topLeft = screenToWorldPoint(
        { x: 0, y: 0 },
        camera,
        displaySize,
        viewportWidth,
        viewportHeight
      );
      const bottomRight = screenToWorldPoint(
        { x: viewportWidth, y: viewportHeight },
        camera,
        displaySize,
        viewportWidth,
        viewportHeight
      );
      const vbW = Math.max(1, bottomRight.x - topLeft.x);
      return {
        viewBox: `${topLeft.x.toFixed(2)} ${topLeft.y.toFixed(2)} ${vbW.toFixed(2)} ${Math.max(1, bottomRight.y - topLeft.y).toFixed(2)}`,
        strokeUnit: vbW / Math.max(1, viewportWidth),
      };
    }, [camera, displaySize, viewportWidth, viewportHeight]);

    const spokeRadius = Math.max(WORLD_SPACE_LIMITS.baseRadius, worldRadius);

    const spokes = useMemo(() => {
      return Array.from({ length: order }, (_, i) => {
        const angle = (i * 2 * Math.PI) / order - Math.PI / 2;
        return {
          x2: LOGICAL_CENTER.x + spokeRadius * Math.cos(angle),
          y2: LOGICAL_CENTER.y + spokeRadius * Math.sin(angle),
        };
      });
    }, [order, spokeRadius]);

    const activeExtendedRings = useMemo(
      () => EXTENDED_RING_STEPS.filter((r) => r <= worldRadius + 1),
      [worldRadius]
    );

    const su = viewBoxInfo.strokeUnit;

    return (
      <svg
        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-200"
        width={viewportWidth}
        height={viewportHeight}
        viewBox={viewBoxInfo.viewBox}
        aria-hidden="true"
      >
        {CANVAS_THEME.guideRingRatios.map((ratio, idx) => (
          <circle
            key={`ring-${idx}`}
            cx={LOGICAL_CENTER.x}
            cy={LOGICAL_CENTER.y}
            r={WORLD_SPACE_LIMITS.baseRadius * ratio}
            fill="none"
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(idx === CANVAS_THEME.guideRingRatios.length - 1 ? 1.5 : 1.1) * su}
            strokeDasharray={
              idx === CANVAS_THEME.guideRingRatios.length - 1
                ? undefined
                : `${(idx % 2 === 0 ? 6 : 3) * su},${(idx % 2 === 0 ? 6 : 9) * su}`
            }
            opacity={idx === CANVAS_THEME.guideRingRatios.length - 1 ? '0.35' : '0.24'}
          />
        ))}

        {activeExtendedRings.map((radius, idx) => (
          <circle
            key={`ext-ring-${radius}`}
            cx={LOGICAL_CENTER.x}
            cy={LOGICAL_CENTER.y}
            r={radius}
            fill="none"
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(idx === activeExtendedRings.length - 1 ? 1.4 : 1.0) * su}
            strokeDasharray={`${8 * su},${8 * su}`}
            opacity={camera.zoom < 0.85 ? '0.32' : '0.16'}
          />
        ))}

        {spokes.map((s, i) => (
          <line
            key={`spoke-${i}`}
            x1={LOGICAL_CENTER.x}
            y1={LOGICAL_CENTER.y}
            x2={s.x2}
            y2={s.y2}
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(i === 0 ? 1.8 : 1.0) * su}
            strokeDasharray={i === 0 ? undefined : `${5 * su},${7 * su}`}
            opacity={i === 0 ? '0.45' : '0.22'}
          />
        ))}

        <circle
          cx={LOGICAL_CENTER.x}
          cy={LOGICAL_CENTER.y}
          r={4.5 * su}
          fill={CANVAS_THEME.guideStrokeHex}
          opacity="0.7"
        />
        <circle
          cx={LOGICAL_CENTER.x}
          cy={LOGICAL_CENTER.y}
          r={12 * su}
          fill="none"
          stroke={CANVAS_THEME.guideStrokeHex}
          strokeWidth={1.4 * su}
          opacity="0.4"
        />
      </svg>
    );
  }
);

MandalaGuides.displayName = 'MandalaGuides';
