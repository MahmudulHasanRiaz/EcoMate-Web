import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleQueryError } from './query-error-handler'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}))

beforeEach(() => {
  vi.mocked(toastError).mockClear()
})

function axiosError(status: number, url?: string) {
  const err = new AxiosError(`Request failed with status code ${status}`)
  err.response = { status } as never
  if (url) err.config = { url } as never
  return err
}

describe('handleQueryError', () => {
  it('toasts a deduped, endpoint-named error on a 500 — and never navigates', () => {
    handleQueryError(axiosError(500, '/access-presets'))

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Internal Server Error — /access-presets', {
      id: 'query-cache-500',
    })
  })

  it('falls back to the generic message when the failing URL is unknown', () => {
    handleQueryError(axiosError(500))

    expect(toastError).toHaveBeenCalledWith('Internal Server Error!', {
      id: 'query-cache-500',
    })
  })

  it('stays silent on 401 (the apiClient interceptor owns session expiry)', () => {
    handleQueryError(axiosError(401, '/access-presets'))

    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays silent on non-500 statuses and non-Axios errors', () => {
    handleQueryError(axiosError(403, '/access-presets'))
    handleQueryError(axiosError(503, '/access-presets'))
    handleQueryError(new Error('network'))

    expect(toastError).not.toHaveBeenCalled()
  })
})
