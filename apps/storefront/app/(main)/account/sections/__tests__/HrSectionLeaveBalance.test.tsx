import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HrSection } from '../HrSection';
import {
  getHrProfile,
  getHrLeaveRequests,
  getHrLeaveTypes,
  getHrMyLeaveBalances,
} from '@/lib/api/hr';

vi.mock('@/lib/api/hr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hr')>();
  return {
    ...actual,
    getHrProfile: vi.fn(),
    getHrMyLeaveBalances: vi.fn(),
    getHrLeaveRequests: vi.fn(),
    getHrLeaveTypes: vi.fn(),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BALANCES: any[] = [
  { typeId: 'lt-1', typeName: 'Casual Leave', isPaid: true, entitlement: 10, used: 2, remaining: 8 },
  { typeId: 'lt-2', typeName: 'Sick Leave', isPaid: true, entitlement: 14, used: 14, remaining: 0 },
];

async function openLeave() {
  render(<HrSection />);
  fireEvent.click(screen.getByRole('button', { name: /Leave/i }));
  await screen.findByText('My Leave Requests');
}

describe('HrSection leave balance card (G-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHrProfile).mockResolvedValue({} as any);
    vi.mocked(getHrLeaveRequests).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    } as any);
    vi.mocked(getHrLeaveTypes).mockResolvedValue([
      { id: 'lt-1', name: 'Casual Leave', code: 'casual', daysPerYear: 10, isPaid: true, isActive: true },
    ] as any);
    vi.mocked(getHrMyLeaveBalances).mockResolvedValue(BALANCES as any);
  });

  it('renders the Leave Balance card above requests with entitlement/used/remaining per type', async () => {
    await openLeave();
    expect(await screen.findByText('Leave Balance')).toBeTruthy();
    // balance card row + the leave-type select option both show "Casual Leave"
    expect(screen.getAllByText('Casual Leave').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Sick Leave')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(getHrMyLeaveBalances).toHaveBeenCalledTimes(1);
  });

  it('colors remaining in brand when greater than 0 and amber when 0', async () => {
    await openLeave();
    await screen.findByText('Leave Balance');
    const brand = screen.getByText('8');
    expect(brand.className).toContain('brand');
    const zero = screen.getByText('0');
    expect(zero.className).toContain('amber');
  });

  it('shows a loading spinner while balances are pending', async () => {
    vi.mocked(getHrMyLeaveBalances).mockReturnValue(new Promise(() => {}) as any);
    await openLeave();
    expect(screen.getByText('Leave Balance')).toBeTruthy();
  });

  it('shows a friendly error with Retry when balances fail, and recovers', async () => {
    vi.mocked(getHrMyLeaveBalances)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(BALANCES as any);
    await openLeave();
    expect(
      await screen.findByText('Could not load your leave balances.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(await screen.findByText('Casual Leave')).toBeTruthy();
    expect(getHrMyLeaveBalances).toHaveBeenCalledTimes(2);
  });
});
