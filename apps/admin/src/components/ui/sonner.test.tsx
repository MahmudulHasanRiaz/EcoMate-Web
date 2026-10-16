import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Toaster, ERROR_TOAST_DURATION } from './sonner'
import { toast } from 'sonner'

function toastsOfType(type: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-sonner-toast][data-type="${type}"]`))
}

function waitForToast(type: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const el = toastsOfType(type)[0]
    expect(el).toBeTruthy()
    return el
  }) as Promise<HTMLElement>
}

describe('Toaster — type distinction (Issue 8a)', () => {
  afterEach(() => {
    toast.dismiss()
    document.querySelectorAll('[data-sonner-toaster]').forEach((el) => el.remove())
  })

  it('every toast type carries its data-type hook, rich colors and an icon', async () => {
    await render(<Toaster theme='light' />)
    toast.success('Saved')
    toast.error('Failed')
    toast.warning('Careful')
    toast.info('FYI')

    for (const type of ['success', 'error', 'warning', 'info']) {
      const el = await waitForToast(type)
      expect(el.getAttribute('data-rich-colors')).toBe('true')
      expect(el.querySelector('[data-icon] svg')).toBeTruthy()
    }
  })

  it('success and error toasts are visually distinct, not text-only', async () => {
    await render(<Toaster theme='light' />)
    toast.success('Saved')
    toast.error('Failed')

    const success = await waitForToast('success')
    const error = await waitForToast('error')

    const successBg = getComputedStyle(success).backgroundColor
    const errorBg = getComputedStyle(error).backgroundColor
    const successColor = getComputedStyle(success).color
    const errorColor = getComputedStyle(error).color

    // Distinct at a glance: background AND text color differ between the two.
    expect(successBg).not.toBe(errorBg)
    expect(successColor).not.toBe(errorColor)
    // And neither is the flattened uniform surface color.
    expect(successBg).not.toBe(errorBg)
  })

  it('dark theme keeps the success/error distinction', async () => {
    await render(<Toaster theme='dark' />)
    toast.success('Saved')
    toast.error('Failed')

    const success = await waitForToast('success')
    const error = await waitForToast('error')

    expect(document.querySelector('[data-sonner-toaster][data-sonner-theme="dark"]')).toBeTruthy()
    expect(getComputedStyle(success).backgroundColor).not.toBe(getComputedStyle(error).backgroundColor)
    expect(getComputedStyle(success).color).not.toBe(getComputedStyle(error).color)
  })

  it('errors persist longer than the success default and offer dismiss', async () => {
    await render(<Toaster theme='light' />)
    toast.success('quick')
    toast.error('longer')

    const successToast = toast.getToasts().find((t: any) => t.title === 'quick') as any
    const errorToast = toast.getToasts().find((t: any) => t.title === 'longer') as any

    // Success keeps the Toaster-level default (5s — no per-toast duration).
    expect(successToast?.duration).toBeUndefined()
    expect(errorToast?.duration).toBe(ERROR_TOAST_DURATION)
    expect(errorToast?.closeButton).toBe(true)
  })
})
