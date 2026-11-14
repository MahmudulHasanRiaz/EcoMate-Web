/**
 * Video-embed poster field: URL input is primary, Media Library picker
 * secondary (owner decision 2026-11-14). The picker stub below stands in
 * for the real MediaPicker dialog so the test proves the wiring in
 * LandingPages (picker target kind 'poster' -> section.poster), not the
 * picker's own media fetching, which has its own tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SidebarProvider } from '@/components/ui/sidebar'
import { LandingPages } from '../index'

vi.mock('../api', () => ({
  landingPagesApi: {
    list: vi.fn().mockResolvedValue({ data: { data: [], meta: { totalPages: 1 } } }),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
  },
}))

vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/media-picker', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('@/components/ui/dialog')
  return {
    // A real (nested) Radix dialog, like the real MediaPicker: a plain
    // button rendered under the open form dialog would be aria-hidden and
    // covered by its overlay, so it could never be clicked.
    MediaPicker: ({ open, onSelect }: { open: boolean; onSelect: (urls: string[]) => void }) =>
      open ? (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Media Library</DialogTitle>
            <button type='button' onClick={() => onSelect(['https://cdn.example.com/poster.jpg'])}>
              Pick poster.jpg
            </button>
          </DialogContent>
        </Dialog>
      ) : null,
  }
})

function renderLandingPages() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <LandingPages />
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

async function openVideoEmbedSection(ui: Awaited<ReturnType<typeof renderLandingPages>>) {
  await userEvent.click(ui.getByRole('button', { name: 'Add Landing Page' }))
  await userEvent.click(ui.getByRole('tab', { name: 'Content' }))
  await userEvent.click(ui.getByRole('button', { name: 'Add Section' }))
  await userEvent.click(ui.getByRole('button', { name: 'Video Embed' }))
}

describe('video-embed poster field', () => {
  it('renders a Poster URL input with a Browse button after the Video URL field', async () => {
    const ui = await renderLandingPages()
    await openVideoEmbedSection(ui)

    // URL field is primary: it comes first and takes the row width.
    await expect.element(ui.getByText('Poster URL')).toBeInTheDocument()
    const posterInput = ui.getByPlaceholder('https://...')
    await expect.element(posterInput).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Browse' })).toBeInTheDocument()
    // The video URL field is still there, above the poster field.
    await expect.element(ui.getByText('Video URL')).toBeInTheDocument()
  })

  it('typing a poster URL stores it on the section', async () => {
    const ui = await renderLandingPages()
    await openVideoEmbedSection(ui)

    const posterInput = ui.getByPlaceholder('https://...')
    await userEvent.fill(posterInput, 'https://cdn.example.com/poster.jpg')
    await expect.element(posterInput).toHaveValue('https://cdn.example.com/poster.jpg')
  })

  it('picking from the media library sets the poster URL', async () => {
    const ui = await renderLandingPages()
    await openVideoEmbedSection(ui)

    await userEvent.click(ui.getByRole('button', { name: 'Browse' }))
    await userEvent.click(ui.getByRole('button', { name: 'Pick poster.jpg' }))
    const posterInput = ui.getByPlaceholder('https://...')
    await expect.element(posterInput).toHaveValue('https://cdn.example.com/poster.jpg')
  })
})
