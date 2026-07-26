import { Search } from 'lucide-react'

export function safeImageUrl(src?: string | null): string | undefined {
  if (!src) return undefined
  if (src.startsWith('http')) return src
  // Resolve /uploads/ through the /api/images/resize endpoint — same as admin SafeImage.
  // This works because POS nginx proxies /api/* to the backend server.
  if (src.startsWith('/uploads/')) {
    const base = import.meta.env.DEV
      ? 'http://localhost:4000/api/images/resize'
      : '/api/images/resize'
    const params = new URLSearchParams()
    params.set('path', src)
    return `${base}?${params.toString()}`
  }
  return src
}

interface SafeImageProps {
  src?: string | null
  alt?: string
  className?: string
}

export function SafeImage({ src, alt, className }: SafeImageProps) {
  if (!src) {
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
      loading="lazy"
    />
  )
}
