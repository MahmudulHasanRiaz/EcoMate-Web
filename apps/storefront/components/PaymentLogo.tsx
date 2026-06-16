'use client';

import Image from 'next/image';
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
  sm: { container: 'h-6 px-2', img: 'h-3.5' },
  md: { container: 'h-8 px-3', img: 'h-5' },
  lg: { container: 'h-10 px-4', img: 'h-6' },
} as const;

const fallbackSize = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-11 h-11 text-sm',
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
  const dims = sizeMap[size];

  if (!src || imgError) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-gray-100 text-gray-500 font-bold shrink-0 ${fallbackSize[size]}`}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0 ${dims.container}`}
      >
        <Image
          src={src}
          alt={label}
          width={40}
          height={20}
          className={`${dims.img} w-auto object-contain`}
          onError={() => setImgError(true)}
        />
      </div>
      {showName && (
        <span className="text-sm font-medium text-gray-700">{label}</span>
      )}
    </div>
  );
}
