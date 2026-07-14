import { useState, useMemo } from 'react'

const PLACEHOLDER_DATA_URI =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="#f0f4ff"/>
      <g transform="translate(200,160)">
        <rect x="-24" y="-18" width="48" height="36" rx="4" fill="#93c5fd" opacity="0.5"/>
        <circle cx="8" cy="-4" r="8" fill="#93c5fd" opacity="0.5"/>
        <rect x="-20" y="6" width="40" height="20" rx="2" fill="#93c5fd" opacity="0.5"/>
      </g>
      <text x="200" y="230" font-family="system-ui,sans-serif" font-size="14" fill="#3b82f6" text-anchor="middle" font-weight="500">
        No Image
      </text>
    </svg>`,
  )

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null
  thumbWidth?: number
  thumbHeight?: number
  variant?: 'thumbnail' | 'small' | 'medium'
  derivativeManifest?: Record<string, string> | null
  blurUrl?: string | null
}

export function SafeImage({ src, alt, className, thumbWidth, thumbHeight, variant, derivativeManifest, blurUrl, ...props }: SafeImageProps) {
  const [failed, setFailed] = useState(false)
  const showPlaceholder = !src || failed

  const finalSrc = useMemo(() => {
    if (!src) return src

    if (variant && derivativeManifest?.[variant]) {
      return derivativeManifest[variant]
    }

    if (!thumbWidth && !thumbHeight) return src

    if (src.startsWith('http')) return src

    if (!src.startsWith('/uploads/')) return src

    const base = import.meta.env.DEV
      ? 'http://localhost:4000/api/images/resize'
      : '/api/images/resize'
    const params = new URLSearchParams()
    params.set('path', src)
    if (thumbWidth) params.set('w', String(thumbWidth))
    if (thumbHeight) params.set('h', String(thumbHeight))
    return `${base}?${params.toString()}`
  }, [src, thumbWidth, thumbHeight, variant, derivativeManifest])

  if (showPlaceholder) {
    return (
      <img
        src={blurUrl || PLACEHOLDER_DATA_URI}
        alt={alt || ''}
        className={className}
        {...props}
      />
    )
  }

  return (
    <img
      src={finalSrc || undefined}
      alt={alt || ''}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
      {...props}
    />
  )
}
