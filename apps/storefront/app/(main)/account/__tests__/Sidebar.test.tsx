import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../Sidebar';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/context/AuthContext';

const mockUseAuth = vi.mocked(useAuth);

function renderFor(user: any) {
  mockUseAuth.mockReturnValue({
    user,
    logout: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    loading: false,
    refreshUser: vi.fn(),
  } as any);
  return render(<Sidebar activeSection="profile" onNavigate={() => {}} />);
}

describe('Sidebar My HR gating (dual-role G-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders My HR when user.isEmployee is true (manager/cashier with Employee record)', () => {
    renderFor({ firstName: 'A', lastName: 'B', email: 'a@b.c', role: 'manager', isEmployee: true });
    expect(screen.getByRole('button', { name: /My HR/i })).toBeTruthy();
  });

  it('hides My HR when isEmployee is false', () => {
    renderFor({ firstName: 'A', lastName: 'B', email: 'a@b.c', role: 'manager', isEmployee: false });
    expect(screen.queryByRole('button', { name: /My HR/i })).toBeNull();
  });

  it('falls back to role employee for older payloads without isEmployee', () => {
    renderFor({ firstName: 'A', lastName: 'B', email: 'a@b.c', role: 'employee' });
    expect(screen.getByRole('button', { name: /My HR/i })).toBeTruthy();
  });

  it('hides My HR for role cashier in older payloads that do not carry isEmployee', () => {
    renderFor({ firstName: 'A', lastName: 'B', email: 'a@b.c', role: 'cashier' });
    expect(screen.queryByRole('button', { name: /My HR/i })).toBeNull();
  });
});
