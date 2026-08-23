import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HrSection } from '../HrSection';
import { getHrProfile, getHrMyAttendance } from '@/lib/api/hr';

vi.mock('@/lib/api/hr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hr')>();
  return {
    ...actual,
    getHrProfile: vi.fn(),
    getHrMyAttendance: vi.fn(),
  };
});

const RECORDS = [
  {
    id: 'att-1',
    employeeId: 'EMP-001',
    date: '2026-08-20T00:00:00.000Z',
    status: 'PRESENT',
    checkInTime: '2026-08-20T03:30:00.000Z',
    checkOutTime: '2026-08-20T12:00:00.000Z',
    note: null,
    createdAt: '2026-08-20T03:31:00.000Z',
  },
  {
    id: 'att-2',
    employeeId: 'EMP-001',
    date: '2026-08-19T00:00:00.000Z',
    status: 'WEEKLY_OFF',
    checkInTime: null,
    checkOutTime: null,
    note: null,
    createdAt: '2026-08-19T03:31:00.000Z',
  },
] as const;

describe('HrSection attendance self-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHrProfile).mockResolvedValue({} as any);
  });

  it('renders the Attendance pill alongside other HR tabs', () => {
    render(<HrSection />);
    const pill = screen.getByRole('button', { name: /Attendance/i });
    expect(pill).toBeTruthy();
  });

  it('shows only own records (no employeeId param) when the pill is opened', async () => {
    vi.mocked(getHrMyAttendance).mockResolvedValue([...RECORDS] as any);

    render(<HrSection />);
    fireEvent.click(screen.getByRole('button', { name: /Attendance/i }));

    expect(await screen.findByText('My Attendance')).toBeTruthy();
    expect(await screen.findByText('Present')).toBeTruthy();
    expect(screen.getByText('Weekly Off')).toBeTruthy();

    expect(getHrMyAttendance).toHaveBeenCalledTimes(1);
    expect(getHrMyAttendance).toHaveBeenCalledWith();
    expect(
      (vi.mocked(getHrMyAttendance).mock.calls[0] as [any])[0],
    ).toBeUndefined();
  });

  it('shows empty state when there are no attendance records', async () => {
    vi.mocked(getHrMyAttendance).mockResolvedValue([]);

    render(<HrSection />);
    fireEvent.click(screen.getByRole('button', { name: /Attendance/i }));

    expect(
      await screen.findByText('No attendance records found'),
    ).toBeTruthy();
    expect(getHrMyAttendance).toHaveBeenCalledWith();
  });

  it('does not crash when the attendance request fails', async () => {
    vi.mocked(getHrMyAttendance).mockRejectedValue(new Error('network'));

    render(<HrSection />);
    fireEvent.click(screen.getByRole('button', { name: /Attendance/i }));

    expect(
      await screen.findByText('No attendance records found'),
    ).toBeTruthy();
  });
});