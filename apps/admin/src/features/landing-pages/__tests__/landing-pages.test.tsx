import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { PromptReferenceModal } from '../index'
import {
  AI_INSTRUCTION_SECTIONS,
  ALLOWED_HTML_ATTRIBUTES,
  ALLOWED_HTML_TAGS,
  CHECKOUT_MOUNT_HTML,
  buildAiInstructions,
} from '../ai-instructions'
import {
  buildPreviewUrl,
  buildSavePayload,
  buildStorefrontPageUrl,
  getLandingPageStatus,
  mergeTrackingJson,
} from '../helpers'

describe('getLandingPageStatus', () => {
  it('is Draft when never published', () => {
    expect(
      getLandingPageStatus({ isActive: false, isDraft: true, publishedAt: null }),
    ).toBe('Draft')
  })

  it('is Published when active and not a draft', () => {
    expect(
      getLandingPageStatus({ isActive: true, isDraft: false, publishedAt: '2026-11-14T00:00:00Z' }),
    ).toBe('Published')
  })

  it('is Unpublished when published once and now inactive (backend unpublish leaves isDraft false)', () => {
    expect(
      getLandingPageStatus({ isActive: false, isDraft: false, publishedAt: '2026-11-14T00:00:00Z' }),
    ).toBe('Unpublished')
  })

  it('is Unpublished when publishedAt is set even if isDraft is true', () => {
    expect(
      getLandingPageStatus({ isActive: false, isDraft: true, publishedAt: '2026-11-14T00:00:00Z' }),
    ).toBe('Unpublished')
  })
})

describe('mergeTrackingJson', () => {
  it('preserves ogImage and other keys, only setting primaryColor', () => {
    expect(
      mergeTrackingJson({ ogImage: 'https://cdn.example.com/og.jpg', foo: 'bar' }, '#123456'),
    ).toEqual({ ogImage: 'https://cdn.example.com/og.jpg', foo: 'bar', primaryColor: '#123456' })
  })

  it('starts from an empty object when nothing was stored', () => {
    expect(mergeTrackingJson(null, '#123456')).toEqual({ primaryColor: '#123456' })
    expect(mergeTrackingJson(undefined, '#123456')).toEqual({ primaryColor: '#123456' })
  })
})

describe('buildSavePayload (handleSave)', () => {
  const base = {
    title: 'Summer Sale',
    slug: 'summer-sale',
    templateId: 'clothing',
    sections: [{ type: 'hero', title: 'Hi' }],
    customHtml: '<div>hi</div>',
    customCss: '.hero { color: red; }',
    productIds: ['p1'],
    primaryColor: '#3730a3',
    existingTrackingJson: { ogImage: 'https://cdn.example.com/og.jpg' },
  }

  it('includes customCss and merges trackingJson for a custom page', () => {
    const payload = buildSavePayload({ ...base, pageType: 'custom' })
    expect(payload.customCss).toBe('.hero { color: red; }')
    expect(payload.customHtml).toBe('<div>hi</div>')
    expect(payload.sections).toBeNull()
    expect(payload.trackingJson).toEqual({
      ogImage: 'https://cdn.example.com/og.jpg',
      primaryColor: '#3730a3',
    })
  })

  it('nulls customHtml for a template page but keeps customCss and merged trackingJson', () => {
    const payload = buildSavePayload({ ...base, pageType: 'template' })
    expect(payload.customHtml).toBeNull()
    expect(payload.sections).toEqual([{ type: 'hero', title: 'Hi' }])
    expect(payload.customCss).toBe('.hero { color: red; }')
    expect(payload.trackingJson.ogImage).toBe('https://cdn.example.com/og.jpg')
  })

  it('never sends comboIds', () => {
    const payload = buildSavePayload({ ...base, pageType: 'custom' })
    expect('comboIds' in payload).toBe(false)
  })
})

describe('preview / view URLs', () => {
  it('preview URL is absolute with the storefront origin', () => {
    const url = buildPreviewUrl('summer-sale', 'https://demo.ecomate.bd')
    expect(url).toBe('https://demo.ecomate.bd/landing/summer-sale?preview=true')
    expect(url.startsWith('http')).toBe(true)
  })

  it('preview URL defaults to the configured storefront origin (absolute, never relative)', () => {
    const url = buildPreviewUrl('summer-sale')
    expect(url.startsWith('http')).toBe(true)
    expect(url.endsWith('/landing/summer-sale?preview=true')).toBe(true)
  })

  it('published page URL is absolute with the storefront origin', () => {
    expect(buildStorefrontPageUrl('summer-sale', 'https://demo.ecomate.bd')).toBe(
      'https://demo.ecomate.bd/landing/summer-sale',
    )
  })
})

describe('AI instructions (single shared source)', () => {
  it('copied text contains the security contract: no-JS rule, allowlist, mount point', () => {
    const text = buildAiInstructions()
    // No-JS rule
    expect(text).toContain('NO JavaScript')
    expect(text).toContain('javascript:')
    expect(text).toContain('EcoMate.*')
    // HTML fragment, not a document
    expect(text).toContain('HTML FRAGMENT')
    expect(text).not.toContain('cdn.tailwindcss.com')
    expect(text).toContain('never Tailwind classes')
    // Checkout mount point (platform-rendered, never a home-made form)
    expect(text).toContain(CHECKOUT_MOUNT_HTML)
    expect(text).toContain('Never build your own order form')
    // Allowlist (same list the validator + DOMPurify enforce)
    expect(text).toContain(`Tags: ${ALLOWED_HTML_TAGS.join(', ')}`)
    expect(text).toContain(`Attributes: ${ALLOWED_HTML_ATTRIBUTES.join(', ')}`)
    // CSS scoping
    expect(text).toContain('#landing-root')
    expect(text).toContain('@import')
    // Products + tracking are platform-provided
    expect(text).toContain('Products tab')
    expect(text).toContain('Tracking (PageView, ViewContent) is fired automatically')
    // Requirements slot for the user's own brief
    expect(text).toContain('[Describe your page here')
  })

  it('includes the caller requirements in the requirements slot', () => {
    const text = buildAiInstructions('Bengali hero for a winter jacket sale.')
    expect(text).toContain('Bengali hero for a winter jacket sale.')
  })

  it('modal content matches the copied text (single source — every section is in the copy)', () => {
    const text = buildAiInstructions()
    expect(AI_INSTRUCTION_SECTIONS.length).toBeGreaterThan(0)
    for (const section of AI_INSTRUCTION_SECTIONS) {
      expect(text).toContain(section.title)
      expect(text).toContain(section.content)
    }
  })
})

describe('PromptReferenceModal', () => {
  it('renders the new secure contract (no Tailwind CDN / EcoMate SDK / window.products)', async () => {
    const { getByText, getByRole } = await render(<PromptReferenceModal />)
    await userEvent.click(getByRole('button', { name: 'Prompt Reference' }))
    await expect.element(getByText('No JavaScript — ever')).toBeInTheDocument()
    await expect.element(getByText('Checkout — platform-rendered, never build your own form')).toBeInTheDocument()
    await expect.element(getByText('Allowed HTML tags & attributes')).toBeInTheDocument()
    await expect.element(getByRole('button', { name: 'Copy AI instructions' })).toBeInTheDocument()
  })
})
