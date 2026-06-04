"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cancelOrderByToken } from "@/lib/api/orders";

export interface CancelOrderButtonProps {
  orderId: string;
  token: string;
  className?: string;
}

export function CancelOrderButton({
  orderId,
  token,
  className = "",
}: CancelOrderButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await cancelOrderByToken(orderId, token);
      toast.success("Order cancelled");
      router.push("/");
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || (err as Error).message || "Failed to cancel order";
      toast.error(message);
      setSubmitting(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`inline-flex items-center gap-2 bg-white border border-red-200 text-red-600 px-5 py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wider hover:bg-red-50 transition-colors ${className}`}
      >
        <X className="h-4 w-4" />
        Cancel Order
      </button>
    );
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
      <p className="text-sm text-red-900 font-medium">
        Are you sure you want to cancel this order? This cannot be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="inline-flex items-center gap-2 bg-red-600 text-white px-5 py-2 rounded-lg font-bold text-sm hover:bg-red-700 transition-colors disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Cancelling...
            </>
          ) : (
            "Yes, cancel order"
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={submitting}
          className="bg-white border border-gray-200 text-gray-700 px-5 py-2 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
        >
          Keep order
        </button>
      </div>
    </div>
  );
}

export default CancelOrderButton;
