import { getStorefrontUrl } from '@/lib/utils'
import type { LandingPage } from './api'

export type LandingPageStatus = 'Published' | 'Draft' | 'Unpublished'

/**
 * Derive the list status from the row. The backend `unpublish` sets only
 * `isActive: false` and leaves `isDraft: false`, so `isDraft` alone lies:
 * a page that was published once and then unpublished is NOT a draft.
 * Draft = never published; Unpublished = published once, now inactive.
 */
export function getLandingPageStatus(
  p: Pick<LandingPage, 'isActive' | 'isDraft' | 'publishedAt'>,
): LandingPageStatus {
  if (p.isActive && !p.isDraft) return 'Published'
  if (p.publishedAt) return 'Unpublished'
  return 'Draft'
}

/** Merge the new primary colour into the stored trackingJson, preserving
 *  every other key (ogImage, …) instead of overwriting the whole object. */
export function mergeTrackingJson(
  existing: Record<string, any> | null | undefined,
  primaryColor: string,
): Record<string, any> {
  return { ...(existing || {}), primaryColor }
}

export interface SavePayloadInput {
  title: string
  slug: string
  pageType: string
  templateId: string
  sections: any[]
  customHtml: string
  customCss: string
  productIds: string[]
  primaryColor: string
  existingTrackingJson?: Record<string, any> | null
}

/**
 * The exact payload handleSave sends. Custom pages send sections: null and
 * template pages send customHtml: null (existing behaviour, kept). customCss
 * is sent as-is for both types so switching page type never silently wipes
 * it. comboIds are never sent: combos are assigned but rendered nowhere,
 * and existing rows keep their stored value untouched server-side.
 */
export function buildSavePayload(input: SavePayloadInput): Record<string, any> {
  const isCustom = input.pageType === 'custom'
  return {
    title: input.title,
    slug: input.slug,
    pageType: input.pageType,
    templateId: isCustom ? null : input.templateId,
    sections: isCustom ? null : input.sections,
    customHtml: isCustom ? input.customHtml : null,
    customCss: input.customCss,
    productIds: input.productIds,
    trackingJson: mergeTrackingJson(input.existingTrackingJson, input.primaryColor),
  }
}

/** Absolute storefront preview URL. A relative /landing/… URL 404s on the
 *  admin host, so the origin must come from getStorefrontUrl(). */
export function buildPreviewUrl(slug: string, storefrontUrl?: string): string {
  return `${getStorefrontUrl(storefrontUrl)}/landing/${slug}?preview=true`
}

/** Absolute storefront URL for a published page (list "View" action). */
export function buildStorefrontPageUrl(slug: string, storefrontUrl?: string): string {
  return `${getStorefrontUrl(storefrontUrl)}/landing/${slug}`
}
