import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CmsPagesSettings } from './cms-pages-settings'
import { apiClient } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }))
vi.mock('@/components/media-picker', () => ({ MediaPicker: () => null }))

const getMock = apiClient.get as Mock
const putMock = apiClient.put as Mock

const templatePage = {
  id: 'tpl-1',
  slug: 'careers',
  title: 'Careers',
  content: '',
  isActive: true,
  showInFooter: false,
  sortOrder: 0,
  type: 'template',
  templateKey: 'careers',
  config: { hero: { title: 'WE ARE HIRING.' } },
  createdAt: '',
  updatedAt: '',
}

const contentPage = {
  id: 'pg-1',
  slug: 'about-us',
  title: 'About Us',
  content: '<h2>hi</h2>',
  isActive: true,
  showInFooter: true,
  sortOrder: 1,
  type: 'content',
  templateKey: null,
  config: null,
  createdAt: '',
  updatedAt: '',
}

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <CmsPagesSettings />
    </QueryClientProvider>
  )
}

describe('CmsPagesSettings', () => {
  beforeEach(() => {
    getMock.mockReset()
    putMock.mockReset()
    getMock.mockResolvedValue({ data: [templatePage, contentPage] })
    putMock.mockResolvedValue({ data: { ...templatePage } })
  })

  it('renders both the System Pages and Content Pages groups', async () => {
    const { getByText } = await renderSettings()

    await expect.element(getByText('CMS Pages', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('System Pages', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Content Pages', { exact: true })).toBeInTheDocument()
    // system row shows the schema-backed page title
    await expect.element(getByText('Careers')).toBeInTheDocument()
    // content row shows its own title
    await expect.element(getByText('About Us')).toBeInTheDocument()
  })

  it('opens the template settings dialog populated from the page schema', async () => {
    const { getByTitle, getByText } = await renderSettings()

    await userEvent.click(getByTitle('Edit settings'))

    await expect.element(getByText('Careers — Settings')).toBeInTheDocument()
    // schema-driven field is rendered for the template page
    await expect.element(getByText('Hero Title')).toBeInTheDocument()
    await expect.element(getByText('Open Positions')).toBeInTheDocument()
  })

  it('toggles a system page off via its switch', async () => {
    const { getByLabelText } = await renderSettings()

    const sw = getByLabelText('Toggle Careers')
    await expect.element(sw).toHaveAttribute('data-state', 'checked')
    await userEvent.click(sw)

    expect(putMock).toHaveBeenCalledWith('/cms-pages/tpl-1', { isActive: false })
  })

  it('shows content page footer badge', async () => {
    const { getByText } = await renderSettings()

    // content page has showInFooter + active both as "Yes"
    await expect.element(getByText('Yes').first()).toBeInTheDocument()
  })
})
