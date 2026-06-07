import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStorefrontSettings } from './use-storefront-settings'
import { systemSettingsApi } from '@/features/settings/storage-api'

vi.mock('@/features/settings/storage-api', () => ({
  systemSettingsApi: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const MOCK_SETTINGS = {
  store_name: 'EcoMate',
  store_tagline: 'Shop Green',
  store_email: 'hello@ecomate.com',
  store_phone: '+8801700000000',
  store_address: 'Dhaka',
  currency: 'BDT',
  currency_symbol: '\u09e7',
  seo_title: 'EcoMate - Shop Green',
  seo_description: 'Bangladesh eco store',
  seo_keywords: 'eco, green, bangladesh',
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useStorefrontSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(systemSettingsApi.getAll).mockResolvedValue({ data: MOCK_SETTINGS })
  })

  it('loads settings and sets initial values', async () => {
    const { result } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.values.store_name).toBe('EcoMate')
  })

  it('setValue changes a value and marks it dirty', async () => {
    const { result, act } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    await act(() => {
      result.current.setValue('store_name', 'New Name')
    })
    expect(result.current.values.store_name).toBe('New Name')
    expect(result.current.isDirty('store_name')).toBe(true)
  })

  it('isSectionDirty returns true when a field in the section is changed', async () => {
    const { result, act } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    await act(() => {
      result.current.setValue('store_name', 'New Name')
    })
    expect(result.current.isSectionDirty('identity-store')).toBe(true)
    expect(result.current.isSectionDirty('discovery-seo')).toBe(false)
  })

  it('dirtyKeysInSection returns only changed keys', async () => {
    const { result, act } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    await act(() => {
      result.current.setValue('store_name', 'New Name')
    })
    expect(result.current.dirtyKeysInSection('identity-store')).toEqual(['store_name'])
  })

  it('resetSection reverts all fields in that section', async () => {
    const { result, act } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    await act(() => {
      result.current.setValue('store_name', 'New Name')
      result.current.setValue('seo_title', 'New SEO')
    })
    await act(() => {
      result.current.resetSection('identity-store')
    })
    expect(result.current.values.store_name).toBe('EcoMate')
    expect(result.current.values.seo_title).toBe('New SEO')
  })

  it('saveSection calls API for changed keys only', async () => {
    vi.mocked(systemSettingsApi.set).mockResolvedValue({} as any)
    const { result, act } = await renderHook(() => useStorefrontSettings(), {
      wrapper: createWrapper(),
    })
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    await act(() => {
      result.current.setValue('store_name', 'New Name')
    })
    await act(async () => {
      await result.current.saveSection('identity-store')
    })
    expect(systemSettingsApi.set).toHaveBeenCalledTimes(1)
    expect(systemSettingsApi.set).toHaveBeenCalledWith('store_name', 'New Name')
  })
})
