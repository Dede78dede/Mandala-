/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Composable Accessible Modal Shell (DRY / CUPID UI unification).
 * Shared by ExportModal, LSystemModal, and AndroidAnalysisHub with Escape-key support.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  ariaLabel?: string;
  closeButtonAriaLabel?: string;
  icon?: React.ReactNode;
  iconContainerClassName?: string;
  maxWidthClassName?: string;
  heightClassName?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  ariaLabel,
  closeButtonAriaLabel = 'Chiudi',
  icon,
  iconContainerClassName = 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
  maxWidthClassName = 'max-w-md',
  heightClassName = '',
  footer,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.14 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-slate-950/80 backdrop-blur-md"
        onClick={onClose}
      >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className={`relative flex flex-col w-full ${maxWidthClassName} ${heightClassName} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div
                className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${iconContainerClassName}`}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-sm md:text-base font-semibold tracking-tight text-white truncate">
                {title}
              </h2>
              {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition shrink-0"
            aria-label={closeButtonAriaLabel}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {children}

        {footer && (
          <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 shrink-0">
            {footer}
          </div>
        )}
      </motion.div>
      </motion.div>
    </MotionConfig>
  );
};
