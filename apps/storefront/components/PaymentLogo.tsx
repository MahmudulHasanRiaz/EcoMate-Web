'use client';

import { useState } from 'react';

const API = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace('/api', '')
  : '';

const logoMap: Record<string, string> = {
  bkash: `${API}/assets/logos/BKash_Logo.svg`,
  bkash_pgw: `${API}/assets/logos/bkash_payment_logo.png`,
  nagad: `${API}/assets/logos/Nagad_Logo.svg`,
  rocket: `${API}/assets/logos/Rocket_logo.svg`,
  upay: `${API}/assets/logos/Upay_logo.svg`,
  cellfin: `${API}/assets/logos/Cellfin_Logo.png`,
  selfin: `${API}/assets/logos/Cellfin_Logo.png`,
};

const labelMap: Record<string, string> = {
  bkash: 'bKash',
  bkash_pgw: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  upay: 'Upay',
  cellfin: 'Cellfin',
  selfin: 'Selfin',
  cash: 'Cash on Delivery',
};

const sizeMap = {
  sm: 'h-7',
  md: 'h-9',
  lg: 'h-12',
} as const;

const fallbackSize = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
} as const;

export function PaymentLogo({
  method,
  size = 'md',
  showName = false,
}: {
  method: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const key = (method || '').toLowerCase();
  const src = logoMap[key];
  const label = labelMap[key] || method.toUpperCase();
  const hClass = sizeMap[size];

  if (!src || imgError) {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-gray-100 text-gray-500 font-bold shrink-0 ${fallbackSize[size]}`}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <img
        src={src}
        alt={label}
        className={`${hClass} w-auto drop-shadow-sm shrink-0 bg-gray-100 rounded px-1.5 py-0.5`}
        onError={() => setImgError(true)}
      />
      {showName && (
        <span className="text-sm font-medium text-gray-700">{label}</span>
      )}
    </div>
  );
}
