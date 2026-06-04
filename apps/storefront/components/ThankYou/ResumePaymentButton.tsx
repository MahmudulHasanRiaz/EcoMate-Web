"use client";

import { useState } from "react";
import { Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { resumeBkasPayment } from "@/lib/api/orders";

export interface ResumePaymentButtonProps {
  orderId: string;
  partialAmount?: number;
  label?: string;
  className?: string;
}

export function ResumePaymentButton({
  orderId,
  partialAmount,
  label = "Pay with bKash",
  className = "",
}: ResumePaymentButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await resumeBkasPayment(orderId, partialAmount);
      if (res?.bkashURL) {
        window.location.href = res.bkashURL;
        return;
      }
      toast.error("Could not start bKash payment. Please try again.");
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || (err as Error).message || "Failed to start bKash payment";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 bg-pink-600 text-white px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider hover:bg-pink-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Redirecting...
        </>
      ) : (
        <>
          <ExternalLink className="h-4 w-4" />
          {label}
        </>
      )}
    </button>
  );
}

export default ResumePaymentButton;
