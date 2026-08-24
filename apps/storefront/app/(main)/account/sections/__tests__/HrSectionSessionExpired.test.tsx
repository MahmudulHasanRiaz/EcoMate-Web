import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HrSection } from '../HrSection';
import { getHrProfile } from '@/lib/api/hr';

vi.mock('@/lib/api/hr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hr')>();
  return { ...actual, getHrProfile: vi.fn() };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('HrSection session expiry (G-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows one friendly session-expired message when an /hr/my call returns 401', async () => {
    // Profile is the default active tab — it loads on mount.
    vi.mocked(getHrProfile).mockRejectedValue({
      response: { status: 401, data: { message: 'Authentication required' } },
    });

    render(<HrSection />);

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeTruthy();
  });

  it('does not show the session-expired message when hr calls succeed', async () => {
    vi.mocked(getHrProfile).mockResolvedValue({} as any);

    render(<HrSection />);

    await screen.findByText('My Profile');
    const matches = screen.queryAllByText(
      'Your session has expired. Please sign in again.',
    );
    expect(matches.length).toBe(0);
  });
});
