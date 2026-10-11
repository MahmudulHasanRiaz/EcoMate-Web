"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Star, Check, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { normalizePhone } from '@/lib/phone-utils';
import { SheetShell } from './SheetShell';

interface Props {
  productId: string;
  productName: string;
  /** logged-in customer display name; null = guest */
  userLabel: string | null;
  onSubmitted: () => void;
  onClose: () => void;
}

/**
 * Review modal (mockup + guardrail 2b). Only mobile is required, validated
 * with the app's existing Bangladeshi phone validator; rating/review/name
 * stay optional. Success shows the moderation message + DONE.
 */
export function ReviewModal({ productId, productName, userLabel, onSubmitted, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [useMobile, setUseMobile] = useState(!userLabel);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (useMobile) {
      if (!mobile.trim() || !normalizePhone(mobile.trim())) {
        setError('Please enter a valid Bangladeshi mobile number.');
        return;
      }
    }
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post('/reviews', {
        productId,
        customerName: name.trim() || undefined,
        rating: rating >= 1 ? rating : undefined,
        text: text.trim() || undefined,
        mobile: useMobile ? mobile.trim() : undefined,
      });
      setSubmitted(true);
      onSubmitted();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <SheetShell title="Write a review" onClose={onClose}>
        <div className="text-center py-6">
          <span className="mx-auto mb-3 flex w-12 h-12 items-center justify-center rounded-full bg-green-50 text-brand-success">
            <Check size={24} />
          </span>
          <p className="m-0 text-[16px] font-semibold text-brand-dark">Thank you for your review</p>
          <p className="mt-1 text-[14px] text-gray-700">It will appear on this page after a quick check.</p>
          <button
            onClick={onClose}
            className="mt-4 w-full h-10 rounded-[3px] bg-brand-blue text-white text-[13px] font-semibold tracking-wide"
          >
            DONE
          </button>
        </div>
      </SheetShell>
    );
  }

  return (
    <SheetShell title="Write a review" onClose={onClose}>
      <p className="m-0 mb-2 text-[14px] font-medium text-brand-dark">{productName}</p>
      <form onSubmit={handleSubmit}>
        <label className="block text-[13px] font-medium mt-[14px] mb-[6px]">
          Your rating <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={rating === s}
              aria-label={`Rate ${s} star${s > 1 ? 's' : ''}`}
              onClick={() => setRating(s)}
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(0)}
              className="p-0.5 transition-transform hover:scale-110 bg-transparent border-0 cursor-pointer min-w-[44px] min-h-[44px]"
            >
              <Star
                size={28}
                className={s <= (hoverRating || rating) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}
                strokeWidth={1.5}
              />
            </button>
          ))}
        </div>

        <label htmlFor="pdp-review-text" className="block text-[13px] font-medium mt-[14px] mb-[6px]">
          Your review <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="pdp-review-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full border border-brand-border focus:border-brand-blue rounded-[3px] px-3 py-[10px] h-auto text-[14px] text-brand-dark bg-white resize-y"
        />

        <label htmlFor="pdp-review-name" className="block text-[13px] font-medium mt-[14px] mb-[6px]">
          Name <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <input
          id="pdp-review-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-brand-border focus:border-brand-blue rounded-[3px] px-3 h-10 text-[14px] text-brand-dark bg-white"
        />

        {useMobile ? (
          <>
            <label htmlFor="pdp-review-mobile" className="block text-[13px] font-medium mt-[14px] mb-[6px]">
              Mobile number <span className="text-brand-danger">*</span>
            </label>
            <input
              id="pdp-review-mobile"
              type="tel"
              inputMode="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="01XXXXXXXXX"
              className="w-full border border-brand-border focus:border-brand-blue rounded-[3px] px-3 h-10 text-[14px] text-brand-dark bg-white"
            />
            <p className="m-0 mt-1 text-[12px] text-gray-500">Used only to confirm your review. Never shown publicly.</p>
          </>
        ) : (
          <div className="mt-[14px] rounded-[3px] bg-green-50 px-3 py-2 text-[13px] text-brand-success">
            ✓ Reviewing as a logged-in customer.{' '}
            <button type="button" onClick={() => setUseMobile(true)} className="underline underline-offset-2 bg-transparent border-0 p-0 text-inherit cursor-pointer text-[13px]">
              Use mobile number instead
            </button>
          </div>
        )}

        {error && (
          <p className="text-[13px] text-brand-danger bg-red-50 rounded-[3px] px-4 py-2 mt-3">{error}</p>
        )}

        {!userLabel && (
          <p className="mt-3 text-[13px] text-gray-500">
            Have an account? <Link href="/account" className="text-brand-blue font-medium">Log in instead</Link>
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-4 w-full h-10 rounded-[3px] bg-brand-blue text-white text-[13px] font-semibold tracking-wide flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          SUBMIT REVIEW
        </button>
      </form>
    </SheetShell>
  );
}
