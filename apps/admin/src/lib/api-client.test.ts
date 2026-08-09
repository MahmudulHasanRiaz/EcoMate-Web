import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError } from 'axios'
import { apiClient } from './api-client'
import { useAuthStore } from '@/stores/auth-store'

function unauthorized(config: any): never {
  throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, config, {
    status: 401,
    statusText: 'Unauthorized',
    data: { message: 'Authentication required' },
    headers: {},
    config,
  } as any)
}

/** Adapter that 401s the first attempt (config._retry unset) and replays ok. */
function retryAdapter() {
  return (async (config: any) => {
    if (config._retry) {
      return {
        data: { ok: true, url: config.url },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    return unauthorized(config)
  }) as any
}

describe('apiClient refresh interceptor', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.reset()
    document.cookie =
      'eco_mate_access_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    vi.restoreAllMocks()
    apiClient.defaults.adapter = retryAdapter()
  })

  it('refreshes on a 401 and replays the original request with the rotated token', async () => {
    const refreshSpy = vi.spyOn(axios, 'post').mockImplementation(async (url) => {
      expect(String(url)).toContain('/auth/refresh')
      return { data: { accessToken: 'fresh-access-token' } } as any
    })

    const res = await apiClient.get('/protected/resource')

    expect(res.data.ok).toBe(true)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().auth.accessToken).toBe('fresh-access-token')
  })

  it('issues a FRESH refresh for each new 401 instead of reusing a stale token', async () => {
    let refreshCount = 0
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      refreshCount += 1
      return { data: { accessToken: `refreshed-${refreshCount}` } } as any
    })

    await apiClient.get('/a')
    await apiClient.get('/b')

    // Two DISTINCT 401s must trigger two separate /auth/refresh calls — before
    // the fix the second one reused the first (now-expired) token and failed.
    expect(refreshCount).toBe(2)
  })

  it('never triggers a refresh for 401s on the auth/login endpoint itself', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'x' },
    } as any)
    await expect(apiClient.post('/auth/login')).rejects.toMatchObject({
      response: { status: 401 },
    })
    // No refresh is attempted when the failing request is on an auth path.
    expect(postSpy).not.toHaveBeenCalled()
  })
})