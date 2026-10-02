import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { HelpPage } from './index'

vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

function wrap(ui: ReactElement) {
  return render(ui)
}

describe('HelpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('documents every HR module that ships in the sidebar', async () => {
    const { getByText } = await wrap(<HelpPage />)

    // The previous guide was written before shifts, overtime, task tracking,
    // the performance page and access presets existed, so it documented none of
    // them — a manager following it could not find or interpret any of it.
    await expect.element(getByText('শিফট প্রিসেট (Shift Presets)')).toBeInTheDocument()
    await expect.element(getByText('ওভারটাইম কীভাবে হিসাব হয় (How Overtime Is Calculated)')).toBeInTheDocument()
    await expect.element(getByText('টাস্ক ও সময় ট্র্যাকিং (Task Time Tracking)')).toBeInTheDocument()
    await expect.element(getByText('পারফরম্যান্স — Order Funnel (Order Performance)')).toBeInTheDocument()
    await expect.element(getByText('পারফরম্যান্স — Task Productivity (Task Productivity)')).toBeInTheDocument()
    await expect.element(getByText('অ্যাক্সেস প্রিসেট (Access Presets)')).toBeInTheDocument()
  })

  it('keeps the pre-existing sections', async () => {
    const { getByText } = await wrap(<HelpPage />)

    await expect.element(getByText('শুরুর আগে (Getting Started)')).toBeInTheDocument()
    await expect.element(getByText('কর্মচারী ব্যবস্থাপনা (Employee Management)')).toBeInTheDocument()
    await expect.element(getByText('বেতন ও পে-রোল (Salary & Payroll)')).toBeInTheDocument()
    await expect.element(getByText('কমিশন (Commission)')).toBeInTheDocument()
    await expect.element(getByText('ছুটি (Leave)')).toBeInTheDocument()
    await expect.element(getByText('উপস্থিতি — APP / MACHINE / BOTH (Attendance)')).toBeInTheDocument()
    await expect.element(getByText('ডিভাইস (Devices)')).toBeInTheDocument()
    await expect.element(getByText('নিজের তথ্য দেখা ও ছুটি আবেদন (My Employee Profile)')).toBeInTheDocument()
    await expect.element(getByText('উপস্থিতি উইজেট — কোথায় পাবেন (Attendance Widget)')).toBeInTheDocument()
    await expect.element(getByText('পরিভাষা তালিকা (Glossary)')).toBeInTheDocument()
    await expect.element(getByText('সমস্যা সমাধান (Troubleshooting)')).toBeInTheDocument()
  })

  it('links to every real HR destination instead of plain text', async () => {
    await wrap(<HelpPage />)

    // Previously the guide had zero links, so a reader could not reach the page
    // a step referred to.
    await vi.waitFor(() => {
      const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
      for (const path of [
        '/hr/overview',
        '/hr/performance',
        '/hr/employees',
        '/hr/payroll',
        '/hr/commissions',
        '/hr/leave',
        '/hr/attendance',
        '/hr/shifts',
        '/hr/settings',
      ]) {
        expect(hrefs, `missing link to ${path}`).toContain(path)
      }
    }, { timeout: 3000 })
  })

  // Regression: the guide told staff to leave the admin app and use the
  // storefront for their own attendance, leave, salary and payslips — all of
  // which the admin app already provides, and several of which it alone provides
  // (NID, address, bank details, password change).
  it('never sends staff to the storefront for something admin already does', async () => {
    const { getByRole } = await wrap(<HelpPage />)

    // Expand every accordion so the whole document is searchable at once.
    const buttons = [...document.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[]
    for (const b of buttons) {
      if (b.getAttribute('aria-expanded') !== 'false') continue
      b.scrollIntoView({ block: 'center' })
      b.click()
      await new Promise((r) => setTimeout(r, 60))
    }

    await vi.waitFor(() => {
      const text = document.body.textContent || ''
      // The only remaining storefront mentions must be corrections that say
      // staff do NOT need to go there, or notes about what storefront lacks.
      const bad = text.match(/storefront-এর My HR থেকে দেখতে পায়|storefront-এর My HR → Leave থেকে আবেদন করে|Storefront-এ লগ ইন করে Account/)
      expect(bad, `guide still redirects staff to storefront: ${bad?.[0]}`).toBeNull()
      // And it must positively state that admin is enough.
      expect(text).toMatch(/এই Admin অ্যাপেই করা যায়/)
    }, { timeout: 4000 })
  })

  it('points staff at the real admin self-service entry points', async () => {
    const { getByRole } = await wrap(<HelpPage />)

    // /op/my-profile is reachable from the avatar menu and the header clock
    // popover; it is not a sidebar item, so the guide has to name both.
    await vi.waitFor(() => {
      const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') || '')
      expect(hrefs.some((h) => h.endsWith('/op/my-profile'))).toBe(true)
    }, { timeout: 3000 })

    // Both labels are real: "My Employee Profile" is the avatar-menu entry
    // (nav-user.tsx:214) and "My Attendance & Leaves" is the header-clock
    // popover link (attendance-clock.tsx:372). The guide must name both, since
    // /op/my-profile has no sidebar entry.
    for (const name of [/উপস্থিতি উইজেট/, /নিজের তথ্য দেখা ও ছুটি আবেদন/]) {
      await userEvent.click(getByRole('button', { name }))
    }

    await vi.waitFor(() => {
      const text = document.body.textContent || ''
      expect(text).toMatch(/My Employee Profile/)
      expect(text).toMatch(/My Attendance & Leaves/)
    }, { timeout: 3000 })
  })

  it('does not print a login credential in the getting-started step', async () => {
    await wrap(<HelpPage />)

    // The old text hardcoded admin@ecomate.com, which is a credential leak in
    // user-facing documentation.
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toMatch(/admin@ecomate\.com/)
      expect(document.body.textContent).toContain('Admin panel-এ লগ ইন করুন')
    }, { timeout: 3000 })
  })

  it('states the overtime rule exactly as the code computes it', async () => {
    await wrap(<HelpPage />)

    // vitest-browser-react exposes neither getAttribute nor .element, so read
    // the accordion state off the DOM and drive it through userEvent.
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /ওভারটাইম কীভাবে হিসাব হয়/.test(b.textContent || ''),
    ) as HTMLButtonElement | undefined
    expect(btn, 'overtime section button must exist').toBeTruthy()
    if (btn!.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(btn as unknown as Element)
    }

    // deriveDayMetrics: overtime = max(0, worked - scheduled)
    await vi.waitFor(() => {
      const text = document.body.textContent || ''
      expect(text).toMatch(/কাজ করা সময় − নির্ধারিত সময়, তবে শূন্যের নিচে নামবে না/)
      expect(text).toMatch(/ছোট দিন কখনো ওভারটাইম দেয় না/)
      // It is reporting-only; overtime pricing is not implemented.
      expect(text).toMatch(/পে-রোলে যায় না/)
    }, { timeout: 3000 })
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

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}