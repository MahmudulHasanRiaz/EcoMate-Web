import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HrSection } from '../HrSection';
import {
  getHrProfile,
  getHrMyAttendance,
  getHrMyAttendanceToday,
  hrMyCheckIn,
  hrMyBreakStart,
  hrMyBreakEnd,
  hrMyCheckOut,
} from '@/lib/api/hr';

vi.mock('@/lib/api/hr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hr')>();
  return {
    ...actual,
    getHrProfile: vi.fn(),
    getHrMyAttendance: vi.fn(),
    getHrMyAttendanceToday: vi.fn(),
    hrMyCheckIn: vi.fn(),
    hrMyBreakStart: vi.fn(),
    hrMyBreakEnd: vi.fn(),
    hrMyCheckOut: vi.fn(),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RECORDS: any[] = [
  {
    id: 'att-1',
    employeeId: 'EMP-001',
    date: '2026-08-20T00:00:00.000Z',
    status: 'PRESENT',
    attendanceMethod: 'APP',
    workedMinutes: 510,
    breakMinutes: 40,
    note: null,
    createdAt: '2026-08-20T03:31:00.000Z',
  },
  {
    id: 'att-2',
    employeeId: 'EMP-001',
    date: '2026-08-19T00:00:00.000Z',
    status: 'WEEKLY_OFF',
    attendanceMethod: 'MACHINE',
    workedMinutes: 0,
    breakMinutes: 0,
    note: null,
    createdAt: '2026-08-19T03:31:00.000Z',
  },
];

function mockBase() {
  vi.mocked(getHrProfile).mockResolvedValue({} as any);
  vi.mocked(getHrMyAttendance).mockResolvedValue([...RECORDS]);
  vi.mocked(getHrMyAttendanceToday).mockResolvedValue({
    state: 'before_work',
    workedMinutes: 0,
    breakMinutes: 0,
  } as any);
}

async function openAttendance() {
  render(<HrSection />);
  fireEvent.click(screen.getByRole('button', { name: /Attendance/i }));
  await screen.findByText('My Attendance');
}

describe('HrSection attendance self-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBase();
  });

  it('renders the Attendance pill alongside other HR tabs', () => {
    render(<HrSection />);
    const pill = screen.getByRole('button', { name: /Attendance/i });
    expect(pill).toBeTruthy();
  });

  it('shows only own data (no employeeId params) when the pill is opened', async () => {
    await openAttendance();

    expect(getHrMyAttendance).toHaveBeenCalledTimes(1);
    expect(getHrMyAttendance).toHaveBeenCalledWith();
    expect(getHrMyAttendanceToday).toHaveBeenCalledTimes(1);
    expect(getHrMyAttendanceToday).toHaveBeenCalledWith();
  });

  it('shows the Check In state machine card and posts a check-in on click', async () => {
    vi.mocked(hrMyCheckIn).mockResolvedValue({ id: 's1' } as any);
    vi.mocked(getHrMyAttendanceToday).mockResolvedValueOnce({
      state: 'before_work',
      workedMinutes: 0,
      breakMinutes: 0,
    } as any);

    await openAttendance();

    expect(await screen.findByText('Not Checked In Yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Check In/i }));

    await waitFor(() => expect(hrMyCheckIn).toHaveBeenCalledTimes(1));
    expect(hrMyCheckIn).toHaveBeenCalledWith();
  });

  it('shows Working since with Start Break and Check Out when already checked in', async () => {
    vi.mocked(getHrMyAttendanceToday).mockResolvedValue({
      state: 'working',
      checkInAt: '2026-08-24T03:02:00.000Z',
      workedMinutes: 125,
      breakMinutes: 12,
    } as any);

    await openAttendance();

    expect(await screen.findByText(/Working since/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start Break/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check Out/i })).toBeTruthy();
  });

  it('starts and ends a break through the state machine', async () => {
    vi.mocked(getHrMyAttendanceToday)
      .mockResolvedValueOnce({
        state: 'working',
        checkInAt: '2026-08-24T03:02:00.000Z',
        workedMinutes: 60,
        breakMinutes: 0,
      } as any)
      .mockResolvedValueOnce({
        state: 'on_break',
        checkInAt: '2026-08-24T03:02:00.000Z',
        workedMinutes: 60,
        breakMinutes: 8,
      } as any);
    vi.mocked(hrMyBreakStart).mockResolvedValue({ id: 'b1' } as any);
    vi.mocked(hrMyBreakEnd).mockResolvedValue({ id: 'b1' } as any);

    await openAttendance();

    fireEvent.click(screen.getByRole('button', { name: /Start Break/i }));
    await waitFor(() => expect(hrMyBreakStart).toHaveBeenCalledTimes(1));

    await screen.findByRole('button', { name: /End Break/i });
    fireEvent.click(screen.getByRole('button', { name: /End Break/i }));
    await waitFor(() => expect(hrMyBreakEnd).toHaveBeenCalledTimes(1));
  });

  it('shows Checked Out with worked duration and no actions', async () => {
    vi.mocked(getHrMyAttendanceToday).mockResolvedValue({
      state: 'checked_out',
      checkInAt: '2026-08-24T03:02:00.000Z',
      checkOutAt: '2026-08-24T12:44:00.000Z',
      workedMinutes: 462,
      breakMinutes: 45,
    } as any);

    await openAttendance();

    expect(await screen.findByText('Checked Out')).toBeTruthy();
    expect(screen.getByText(/7h 42m/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Check In/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Check Out/i })).toBeNull();
  });

  it('renders history rows with durations and method labels', async () => {
    await openAttendance();

    expect(screen.getByText('Present')).toBeTruthy();
    expect(screen.getByText('Weekly Off')).toBeTruthy();
    expect(screen.getByText('8h 30m')).toBeTruthy();
    expect(screen.getByText('40m')).toBeTruthy();
    expect(screen.getAllByText('App').length).toBeGreaterThan(0);
    expect(screen.getByText('Machine')).toBeTruthy();
  });

  it('shows a friendly error with Retry (not blank) when today state fails', async () => {
    vi.mocked(getHrMyAttendanceToday).mockRejectedValue(new Error('network'));

    await openAttendance();

    expect(await screen.findByText('Could not load your attendance.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
  });

  it('recovers when Retry is clicked after a failure', async () => {
    vi.mocked(getHrMyAttendanceToday)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        state: 'before_work',
        workedMinutes: 0,
        breakMinutes: 0,
      } as any);

    await openAttendance();

    expect(await screen.findByText('Could not load your attendance.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    expect(await screen.findByText('Not Checked In Yet')).toBeTruthy();
    expect(getHrMyAttendanceToday).toHaveBeenCalledTimes(2);
  });

  it('shows the server message in an error toast when check-in fails', async () => {
    vi.mocked(hrMyCheckIn).mockRejectedValue({
      response: { data: { message: 'এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।' } },
    });

    await openAttendance();

    fireEvent.click(screen.getByRole('button', { name: /Check In/i }));

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।',
      );
    });
  });
});