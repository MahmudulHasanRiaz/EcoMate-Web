import { API_BASE_URL, apiUrl, backendAssetUrl } from './api-base'

export type MediaSource =
  | string
  | null
  | undefined
  | {
      url?: unknown
      src?: unknown
      path?: unknown
      originalUrl?: unknown
      version?: unknown
    }
  | readonly unknown[]

export interface ImageTransform {
  width?: number
  height?: number
  quality?: number
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  version?: string | number | Date | null
}

/**
 * Accept current string URLs plus legacy `{ url }`, `{ src }`, and `{ path }`
 * records. Arrays are searched in order so callers can express precedence.
 */
export function firstMediaUrl(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    if (typeof source === 'string') {
      const trimmed = source.trim()
      if (trimmed) return trimmed
      continue
    }

    if (Array.isArray(source)) {
      const nested = firstMediaUrl(...source)
      if (nested) return nested
      continue
    }

    if (source && typeof source === 'object') {
      const record = source as Record<string, unknown>
      const nested = firstMediaUrl(record.url, record.src, record.path)
      if (nested) return nested
    }
  }

  return undefined
}

export function productImageUrl(product: unknown): MediaSource {
  if (!product || typeof product !== 'object') return undefined
  const record = product as Record<string, unknown>
  const original = firstMediaUrl(record.images, record.image)
  return mediaReference(original, record)
}

/**
 * Variant galleries are the canonical source. The legacy singular image and
 * parent product image are fallbacks only.
 */
export function variantImageUrl(
  variant: unknown,
  parentProduct?: unknown,
): MediaSource {
  const variantRecord =
    variant && typeof variant === 'object'
      ? (variant as Record<string, unknown>)
      : {}
  const parentRecord =
    parentProduct && typeof parentProduct === 'object'
      ? (parentProduct as Record<string, unknown>)
      : {}

  const original = firstMediaUrl(
    variantRecord.images,
    variantRecord.image,
    parentRecord.images,
    parentRecord.image,
  )
  return mediaReference(original, parentRecord, variantRecord)
}

function mediaReference(
  original: string | undefined,
  ...owners: Record<string, unknown>[]
): MediaSource {
  if (!original) return undefined
  const media = preferredMediaMetadata(original, ...owners)
  if (!media) return original
  return {
    url: media.derivative || original,
    originalUrl: original,
    version: media.version,
  }
}

/**
 * POS product payloads carry media metadata keyed by the canonical original
 * URL. Prefer a generated derivative when available, while retaining the
 * original as the authoritative fallback.
 */
function preferredMediaMetadata(
  original: string | undefined,
  ...owners: Record<string, unknown>[]
): { derivative?: string; version?: unknown } | undefined {
  if (!original) return undefined

  for (const owner of owners) {
    const metadata =
      owner._mediaMeta && typeof owner._mediaMeta === 'object'
        ? (owner._mediaMeta as Record<string, unknown>)
        : undefined
    const media =
      metadata?.[original] && typeof metadata[original] === 'object'
        ? (metadata[original] as Record<string, unknown>)
        : undefined
    const manifest =
      media?.derivativeManifest &&
      typeof media.derivativeManifest === 'object'
        ? (media.derivativeManifest as Record<string, unknown>)
        : undefined
    const derivative = firstMediaUrl(
      manifest?.small,
      manifest?.thumbnail,
      manifest?.medium,
      manifest?.large,
    )
    if (derivative || media?.updatedAt) {
      return { derivative, version: media?.updatedAt }
    }
  }

  return undefined
}

function localUploadPath(src: string): string | null {
  if (/^\/?uploads\//i.test(src)) {
    return `/${src.replace(/^\/+/, '')}`
  }

  if (!/^https?:\/\//i.test(src)) return null

  try {
    const parsed = new URL(src)
    if (!parsed.pathname.startsWith('/uploads/')) return null

    // Do not rewrite an arbitrary CDN/R2 URL merely because its public path
    // happens to start with /uploads. Only URLs already pointing at this
    // deployment's backend origin are local.
    if (/^https?:\/\//i.test(API_BASE_URL)) {
      return parsed.origin === new URL(API_BASE_URL).origin
        ? parsed.pathname
        : null
    }
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
      return parsed.pathname
    }
    return null
  } catch {
    return null
  }
}

function normalizedVersion(
  version: ImageTransform['version'],
): string | undefined {
  if (version == null || version === '') return undefined
  if (version instanceof Date) return version.toISOString()
  return String(version)
}

function versionedUrl(url: string, version: string | undefined): string {
  if (!version) return url
  const hashIndex = url.indexOf('#')
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}v=${encodeURIComponent(version)}${hash}`
}

/**
 * Resolve local uploads through the image endpoint and leave public R2/S3
 * URLs direct. Absolute legacy upload URLs are intentionally rebound to the
 * currently configured API so restores from a different host still work.
 */
export function resolveImageUrl(
  source: MediaSource,
  transform: ImageTransform = {},
): string | undefined {
  const src = firstMediaUrl(source)
  if (!src) return undefined
  const sourceRecord =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as { version?: unknown })
      : undefined
  const version = normalizedVersion(
    (sourceRecord?.version as ImageTransform['version']) ?? transform.version,
  )

  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src
  }

  const uploadPath = localUploadPath(src)
  if (uploadPath) {
    const params = new URLSearchParams({ path: uploadPath })
    if (transform.width) params.set('w', String(transform.width))
    if (transform.height) params.set('h', String(transform.height))
    if (transform.quality) params.set('q', String(transform.quality))
    if (transform.fit) params.set('fit', transform.fit)
    if (version) params.set('v', version)
    return `${apiUrl('/images/resize')}?${params.toString()}`
  }

  if (src.startsWith('/assets/')) {
    return versionedUrl(backendAssetUrl(src), version)
  }

  return versionedUrl(src, version)
}

/**
 * Direct source fallback for cases where the resize service is temporarily
 * unavailable but the original upload is still healthy.
 */
export function resolveOriginalImageUrl(
  source: MediaSource,
  fallbackVersion?: ImageTransform['version'],
): string | undefined {
  const sourceRecord =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as { originalUrl?: unknown; version?: unknown })
      : undefined
  const explicitOriginal =
    sourceRecord ? firstMediaUrl(sourceRecord.originalUrl) : undefined
  const src = explicitOriginal ?? firstMediaUrl(source)
  if (!src) return undefined
  const version = normalizedVersion(
    (sourceRecord?.version as ImageTransform['version']) ?? fallbackVersion,
  )

  const uploadPath = localUploadPath(src)
  if (uploadPath) return versionedUrl(backendAssetUrl(uploadPath), version)
  if (src.startsWith('/assets/')) {
    return versionedUrl(backendAssetUrl(src), version)
  }
  return versionedUrl(src, version)
}
