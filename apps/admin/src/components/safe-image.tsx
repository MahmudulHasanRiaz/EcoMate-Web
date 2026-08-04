import { useMemo, useState } from 'react'

const PLACEHOLDER_DATA_URI =
  'data:image/svg+xml;charset=UTF-8,' +
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
    </svg>`
  )

interface SafeImageProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> {
  src?: string | null
  thumbWidth?: number
  thumbHeight?: number
  variant?: 'thumbnail' | 'small' | 'medium'
  derivativeManifest?: Record<string, string> | null
  blurUrl?: string | null
  /** Used when the primary src fails to load (e.g. broken/404 variant image). */
  fallbackSrc?: string | null
}

function resizeUrl(
  src: string,
  thumbWidth?: number,
  thumbHeight?: number
): string | null {
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
}

export function SafeImage({
  src,
  alt,
  className,
  thumbWidth,
  thumbHeight,
  variant,
  derivativeManifest,
  blurUrl,
  fallbackSrc,
  onError,
  ...props
}: SafeImageProps) {
  // Ordered chain of URLs to try, from most-desired to least: resized primary
  // -> original primary -> resized fallback -> original fallback -> placeholder.
  const attempts = useMemo(() => {
    const chain: string[] = []
    const push = (
      candidate: string | null | undefined,
      applyManifest: boolean
    ) => {
      if (!candidate) return
      if (applyManifest && variant && derivativeManifest?.[variant]) {
        if (!chain.includes(derivativeManifest[variant])) {
          chain.push(derivativeManifest[variant])
        }
        if (!chain.includes(candidate)) chain.push(candidate)
        return
      }
      if (thumbWidth || thumbHeight) {
        const resized = resizeUrl(candidate, thumbWidth, thumbHeight)
        if (resized && !chain.includes(resized)) chain.push(resized)
        if (!chain.includes(candidate)) chain.push(candidate)
        return
      }
      if (!chain.includes(candidate)) chain.push(candidate)
    }
    push(src, true)
    push(fallbackSrc, false)
    return chain
  }, [src, fallbackSrc, thumbWidth, thumbHeight, variant, derivativeManifest])

  // Keying the stateful render on the attempt-chain signature makes React
  // remount it whenever the source changes, resetting the fallback attempt.
  return (
    <SafeImageContent
      key={attempts.join('\u0000')}
      attempts={attempts}
      alt={alt}
      className={className}
      blurUrl={blurUrl}
      onError={onError}
      {...props}
    />
  )
}

interface SafeImageContentProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> {
  attempts: string[]
  alt?: string
  className?: string
  blurUrl?: string | null
  onError?: React.ReactEventHandler<HTMLImageElement>
}

function SafeImageContent({
  attempts,
  alt,
  className,
  blurUrl,
  onError,
  ...props
}: SafeImageContentProps) {
  const [attempt, setAttempt] = useState(0)

  const activeSrc = attempts[attempt] ?? null
  const showPlaceholder = !activeSrc

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
      src={activeSrc}
      alt={alt || ''}
      className={className}
      onError={(event) => {
        onError?.(event)
        if (attempt < attempts.length - 1) {
          setAttempt((a) => a + 1)
        } else {
          setAttempt(attempts.length)
        }
      }}
      loading='lazy'
      {...props}
    />
  )
}
