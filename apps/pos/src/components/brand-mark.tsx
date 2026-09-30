import { useState } from 'react'

interface BrandMarkProps {
  /** Store/showroom name shown beside POS. Falls back to EcoMate. */
  name?: string | null
  /** Resolved favicon URL. When absent (or broken) the initial letter shows. */
  faviconUrl?: string
}

/**
 * POS header brand: store favicon (when configured) + "<Store> POS".
 * Falls back to the store-name initial so the badge never renders empty.
 */
export function BrandMark({ name, faviconUrl }: BrandMarkProps) {
  const [imgOk, setImgOk] = useState(true)
  const label = name?.trim() || 'EcoMate'
  const showImg = Boolean(faviconUrl) && imgOk

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-500 text-white font-black text-base shadow-sm">
        {showImg ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          label.charAt(0).toUpperCase()
        )}
      </span>
      <span className="truncate text-base font-extrabold tracking-tight text-slate-900">
        {label} <span className="text-emerald-600">POS</span>
      </span>
    </div>
  )
}
