import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { HelpPage } from './index'

vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

function wrap(ui: ReactElement) {
  return render(ui)
}

describe('HelpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all Bangla tutorial sections', async () => {
    const { getByText } = await wrap(<HelpPage />)

    await expect.element(getByText('শুরুর আগে (Getting Started)')).toBeInTheDocument()
    await expect.element(getByText('কর্মচারী ব্যবস্থাপনা (Employee Management)')).toBeInTheDocument()
    await expect.element(getByText('বেতন ও পে-রোল (Salary & Payroll)')).toBeInTheDocument()
    await expect.element(getByText('কমিশন (Commission)')).toBeInTheDocument()
    await expect.element(getByText('ছুটি (Leave)')).toBeInTheDocument()
    await expect.element(getByText('উপস্থিতি — APP / MACHINE / BOTH (Attendance)')).toBeInTheDocument()
    await expect.element(getByText('ডিভাইস (Devices)')).toBeInTheDocument()
    await expect.element(getByText('My HR (কর্মচারী সেলফ-সার্ভিস)')).toBeInTheDocument()
    await expect.element(getByText('উপস্থিতি — হাতে তৈরি অনুপস্থিতি দিবস (Add Day / Manual Absence)')).toBeInTheDocument()
    await expect.element(getByText('উপস্থিতি — মিসিং চেকআউট (Missing Checkout Handling)')).toBeInTheDocument()
    await expect.element(getByText('ডিভাইস — আনম্যাপড ইভেন্ট (Unmapped Events)')).toBeInTheDocument()
    await expect.element(getByText('কমিশন — রিভার্সাল (Commission Reversals)')).toBeInTheDocument()
    await expect.element(getByText('পে-রোল — মোট ও Void (Payroll Totals & Void)')).toBeInTheDocument()
    await expect.element(getByText('কর্মচারী — পুনর্নিয়োগ (Employee Rehire)')).toBeInTheDocument()
    await expect.element(getByText('ব্যাংক অ্যাকাউন্ট — যাচাই (Bank Account Verification)')).toBeInTheDocument()
    await expect.element(getByText('সেশন মেয়াদোত্তীর্ণ (Session Expiry)')).toBeInTheDocument()
    await expect.element(getByText('পরিভাষা তালিকা (Glossary)')).toBeInTheDocument()
    await expect.element(getByText('সমস্যা সমাধান (Troubleshooting)')).toBeInTheDocument()
  })

  it('expands a collapsed section to reveal its numbered steps', async () => {
    const { getByRole } = await wrap(<HelpPage />)

    const section = getByRole('button', { name: /ডিভাইস \(Devices\)/i })
    await expect.element(section).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(section)

    await expect.element(section).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the first section content open by default', async () => {
    const { getByRole, getByText } = await wrap(<HelpPage />)

    await expect
      .element(getByRole('button', { name: /শুরুর আগে/ }))
      .toHaveAttribute('aria-expanded', 'true')
    await expect.element(getByText(/Admin panel-এ লগ ইন করুন/)).toBeInTheDocument()
  })
})