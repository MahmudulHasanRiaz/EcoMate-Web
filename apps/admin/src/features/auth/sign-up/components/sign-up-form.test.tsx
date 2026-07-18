import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { SignUpForm } from './sign-up-form'

import { apiClient } from '@/lib/api-client'

const FORM_MESSAGES = {
  emailEmpty: 'Please enter your email.',
  passwordEmpty: 'Password must be at least 6 characters long.',
  confirmPasswordEmpty: 'Please confirm your password.',
  passwordMismatch: "Passwords don't match.",
} as const

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}))

const toastPromise = vi.hoisted(() =>
  vi.fn((p: Promise<unknown>, opts: { success?: () => unknown }) => {
    p.then(() => opts.success?.())
  })
)

vi.mock('sonner', () => ({ toast: { promise: toastPromise, success: vi.fn(), error: vi.fn() } }))

describe('SignUpForm', () => {
  let screen: RenderResult
  let emailInput: Locator
  let passwordInput: Locator
  let confirmPasswordInput: Locator
  let submitButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()

    screen = await render(<SignUpForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    passwordInput = screen.getByLabelText(/^Password$/i)
    confirmPasswordInput = screen.getByLabelText(/^Confirm Password$/i)
    submitButton = screen.getByRole('button', { name: /^Create Account$/i })
  })

  it('renders fields and submit button', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(confirmPasswordInput).toBeInTheDocument()
    await expect.element(submitButton).toBeInTheDocument()
  })

  it('shows validation messages when submitting empty form', async () => {
    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText(FORM_MESSAGES.emailEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.confirmPasswordEmpty))
      .toBeInTheDocument()
  })

  it('shows a mismatch error when passwords do not match', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmPasswordInput, '7654321')

    await userEvent.click(submitButton)
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordMismatch))
      .toBeInTheDocument()
  })

  it('disables submit while submitting and re-enables after completion', async () => {
    let resolveDeferred!: (value: unknown) => void
    const deferred = new Promise((resolve) => { resolveDeferred = resolve })
    vi.mocked(apiClient.post).mockReturnValue(deferred as any)

    const firstNameInput = screen.getByRole('textbox', { name: /First Name/i })
    const lastNameInput = screen.getByRole('textbox', { name: /Last Name/i })
    const usernameInput = screen.getByRole('textbox', { name: /Username/i })
    const phoneNumberInput = screen.getByRole('textbox', { name: /Phone Number/i })

    await userEvent.fill(firstNameInput, 'John')
    await userEvent.fill(lastNameInput, 'Doe')
    await userEvent.fill(usernameInput, 'johndoe')
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.fill(phoneNumberInput, '+1234567890')
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmPasswordInput, '1234567')

    await userEvent.click(submitButton)
    await expect.element(submitButton).toBeDisabled()

    resolveDeferred({ data: { user: {}, accessToken: 'tok' } })
    await vi.waitFor(async () => {
      await expect.element(submitButton).toBeEnabled()
    })
  })
})
