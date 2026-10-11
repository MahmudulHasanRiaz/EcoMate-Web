"use client";

import { useEffect, useRef } from 'react';
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
 */
export function SheetShell({ title, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 min-[901px]:items-center min-[901px]:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-white rounded-t-[6px] min-[901px]:rounded-[4px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between bg-white px-[18px] py-3 border-b border-brand-border">
          <h2 className="m-0 text-[17px] font-medium text-brand-dark">{title}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
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
