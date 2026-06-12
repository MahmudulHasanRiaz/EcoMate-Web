"use client";

import { useState, useRef } from "react";
import { Loader2, Upload, X, Image as ImageIcon, AlertCircle, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { submitManualPaymentProof } from "@/lib/api/orders";

const MAX_BYTES = 5 * 1024 * 1024;

export interface PaymentProofUploadProps {
  orderId: string;
  amount?: number;
  className?: string;
}

export function PaymentProofUpload({
  orderId,
  amount,
  className = "",
}: PaymentProofUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setTransactionId("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("File too large. Maximum 5MB allowed.");
      e.target.value = "";
      return;
    }
    if (!f.type.startsWith("image/")) {
      toast.error("Only image files are accepted.");
      e.target.value = "";
      return;
    }
    setFile(f);
    setSubmitted(false);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Please attach a payment screenshot.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitManualPaymentProof(orderId, file, transactionId, amount);
      setSubmitted(true);
      toast.success("Proof submitted. Awaiting verification.");
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || (err as Error).message || "Failed to submit proof";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className={`bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-start gap-3 ${className}`}
      >
        <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-blue-900 text-sm">
            Proof submitted — Awaiting verification
          </p>
          <p className="text-blue-800 text-xs mt-1">
            Our team will verify your payment and update your order status shortly.
            You will receive an SMS confirmation.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 text-xs font-medium text-blue-700 hover:underline"
          >
            Submit a different screenshot
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`bg-white border border-gray-200 rounded-xl p-5 space-y-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-gray-700">
          Send the order total to our bKash number, then upload a screenshot of the
          transaction below. Maximum file size 5MB.
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-600 mb-1">
          Transaction ID (optional)
        </label>
        <input
          type="text"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          placeholder="e.g. TRX123ABC"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-pink-500"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-600 mb-2">
          Payment Screenshot
        </label>
        {preview ? (
          <div className="relative w-32 h-32 border rounded-lg overflow-hidden bg-gray-50">
            <Image src={preview} alt="Preview" width={128} height={128} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={reset}
              className="absolute top-1 right-1 bg-white/90 text-gray-700 rounded-full p-1 hover:bg-white"
              aria-label="Remove file"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 rounded-lg p-6 flex flex-col items-center gap-2 text-gray-500 hover:border-pink-500 hover:text-pink-600 transition-colors"
          >
            <ImageIcon className="h-6 w-6" />
            <span className="text-xs font-medium">Click to choose an image</span>
            <span className="text-[10px] text-gray-400">JPG, PNG up to 5MB</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <button
        type="submit"
        disabled={!file || submitting}
        className="w-full bg-pink-600 text-white px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider hover:bg-pink-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" />
            Submit Payment Proof
          </>
        )}
      </button>
    </form>
  );
}

export default PaymentProofUpload;
