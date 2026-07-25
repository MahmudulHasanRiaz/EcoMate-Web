import { useState } from 'react'
import { Search } from 'lucide-react'

/** Derive the API origin from VITE_API_URL.
 *  "http://localhost:4000/api" -> "http://localhost:4000"
 *  "/api"                     -> "" (same origin — caller falls back to smart default) */
const API_ORIGIN = (() => {
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')
  if (base.startsWith('http')) return base.replace(/\/api$/, '').replace(/\/$/, '')
  return ''
})()

const PLACEHOLDER_SVG =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="#f1f5f9"/>
      <g transform="translate(200,160)">
        <rect x="-24" y="-18" width="48" height="36" rx="4" fill="#cbd5e1" opacity="0.5"/>
        <circle cx="8" cy="-4" r="8" fill="#cbd5e1" opacity="0.5"/>
        <rect x="-20" y="6" width="40" height="20" rx="2" fill="#cbd5e1" opacity="0.5"/>
      </g>
      <text x="200" y="230" font-family="system-ui,sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle" font-weight="500">
        No Image
      </text>
    </svg>`,
  )

export function safeImageUrl(src?: string | null): string | undefined {
  if (!src) return undefined
  if (src.startsWith('http')) return src
  // Resolve /uploads/ paths against the API origin.
  // In prod with relative VITE_API_URL, strip subdomain to reach the main domain
  // e.g. pos.domain.com/uploads/x.jpg → domain.com/uploads/x.jpg
  if (src.startsWith('/uploads/')) {
    if (API_ORIGIN) return `${API_ORIGIN}${src}`
    // Smart default: strip "pos." subdomain prefix so /uploads hits the main API domain
    try {
      const host = window.location.host
      const mainHost = host.replace(/^[^.]+\./, '')  // "pos.fixedplus.com.bd" → "fixedplus.com.bd"
      if (mainHost !== host) {
        return `${window.location.protocol}//${mainHost}${src}`
      }
    } catch {}
    return src
  }
  return src
}

interface SafeImageProps {
  src?: string | null
  alt?: string
  className?: string
}

export function SafeImage({ src, alt, className }: SafeImageProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300 ${className || ''}`}
        style={className?.includes('h-full') ? {} : { width: '100%', aspectRatio: '1' }}>
        <Search size={26} className="opacity-45" />
      </div>
    )
  }

  return (
    <img
      src={safeImageUrl(src)}
      alt={alt || ''}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
