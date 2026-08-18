"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Phone, MessageCircle, X } from "lucide-react";

type BlockedPhoneDialogProps = {
  open: boolean;
  onClose: () => void;
  message: string;
  callNumber?: string;
  whatsapp?: string;
};

export function BlockedPhoneDialog({
  open,
  onClose,
  message,
  callNumber,
  whatsapp,
}: BlockedPhoneDialogProps) {
  const hasCall = !!callNumber;
  const hasWhatsapp = !!whatsapp;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="blocked-phone-title"
          aria-describedby="blocked-phone-desc"
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            aria-label="Close"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px] cursor-default"
            onClick={onClose}
            tabIndex={-1}
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl shadow-black/20 ring-1 ring-amber-200/80 overflow-hidden"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400" />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="px-6 pt-7 pb-6 sm:px-7 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 ring-1 ring-amber-200">
                <AlertTriangle className="h-7 w-7 text-amber-600" />
              </div>
              <h2
                id="blocked-phone-title"
                className="text-lg font-bold text-gray-900"
              >
                Phone Number Blocked
              </h2>
              <p
                id="blocked-phone-desc"
                className="mt-2 text-[13px] leading-relaxed text-gray-600"
              >
                {message}
              </p>

              {(hasCall || hasWhatsapp) && (
                <div className="mt-6 grid grid-cols-1 gap-2.5">
                  {hasCall && (
                    <a
                      href={`tel:${callNumber?.replace(/[^0-9+]/g, "")}`}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-gray-800 active:scale-[0.98]"
                    >
                      <Phone className="h-4 w-4" />
                      Call Support
                    </a>
                  )}
                  {hasWhatsapp && (
                    <a
                      href={`https://wa.me/${whatsapp?.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[#1fb958] active:scale-[0.98]"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Chat on WhatsApp
                    </a>
                  )}
                </div>
              )}

              <button
                onClick={onClose}
                className="mt-4 w-full rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}