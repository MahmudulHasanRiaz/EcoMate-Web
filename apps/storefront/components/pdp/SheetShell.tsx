"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Generic bottom-sheet (≤900px) / centered dialog (>900px) shell for PDP
 * overlays: cart-variant sheet, size guide, review modal.
 * Focus-lite: ESC + backdrop close + body scroll lock + initial focus on
 * the close button. Full focus-trap is handled per-sheet if needed.
 *
 * Motion (P7, modelled on CartDrawer): the shell stays mounted during
 * close — backdrop fades and the panel slides down over
 * var(--duration-drawer) with the standard ease-out curve — and only
 * then calls the parent's onClose to unmount. Enter is the same
 * transition in reverse (slide-up + fade), started on the next frame.
 */
export function SheetShell({ title, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose is an inline arrow at every call site — a new identity per
  // render. Keep the latest in a ref so the mount-once effect below never
  // re-runs (re-running would yank focus back to ✕ on every render, e.g.
  // while picking a size).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [visible, setVisible] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setVisible(false);
    closeTimerRef.current = setTimeout(() => {
      onCloseRef.current();
    }, 300);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      cancelAnimationFrame(raf);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center min-[901px]:items-center min-[901px]:p-4"
      role="presentation"
    >
      {/* Backdrop (CartDrawer pattern: opacity transition, kept mounted) */}
      <div
        data-testid="sheet-backdrop"
        className={`absolute inset-0 bg-black/60 transition-opacity duration-[var(--duration-drawer)] ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-white rounded-t-[6px] min-[901px]:rounded-[4px] transition-[transform,opacity] duration-[var(--duration-drawer)] ease-out will-change-transform ${visible ? 'translate-y-0 min-[901px]:translate-y-0 opacity-100' : 'translate-y-full min-[901px]:translate-y-8 opacity-0 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between bg-white px-[18px] py-3 border-b border-brand-border">
          <h2 className="m-0 text-[17px] font-medium text-brand-dark">{title}</h2>
          <button
            ref={closeRef}
            onClick={handleClose}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[24px] leading-none text-gray-700 bg-transparent border-0 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-[18px] py-4">{children}</div>
      </div>
    </div>
  );
}
