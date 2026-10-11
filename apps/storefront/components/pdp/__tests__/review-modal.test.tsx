import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '@/lib/api-client';
import { ReviewModal } from '../ReviewModal';

vi.mock('@/lib/api-client', () => ({ default: { post: vi.fn() } }));
const postMock = vi.mocked(apiClient.post);

function props(over: any = {}) {
  return {
    productId: 'p1',
    productName: 'Panjabi',
    userLabel: null,
    onSubmitted: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

describe('ReviewModal', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { id: 'r1' } });
  });

  it('renders fields in mockup order with mobile required', () => {
    render(<ReviewModal {...props()} />);
    expect(screen.getByText('Panjabi')).toBeDefined();
    expect(screen.getByText(/Your rating/)).toBeDefined();
    expect(screen.getByText(/Your review/)).toBeDefined();
    expect(screen.getByText('Mobile number')).toBeDefined();
    expect(screen.getByText('SUBMIT REVIEW')).toBeDefined();
  });

  it('refuses submit without mobile and shows BD error on bad format', async () => {
    render(<ReviewModal {...props()} />);
    fireEvent.click(screen.getByText('SUBMIT REVIEW'));
    expect(postMock).not.toHaveBeenCalled();
    const input = screen.getByLabelText(/Mobile number/);
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(screen.getByText('SUBMIT REVIEW'));
    expect(await screen.findByText('Please enter a valid Bangladeshi mobile number.')).toBeDefined();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('submits rating/review/name as optional with valid mobile', async () => {
    render(<ReviewModal {...props()} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('SUBMIT REVIEW'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/reviews', {
      productId: 'p1',
      customerName: undefined,
      rating: undefined,
      text: undefined,
      mobile: '01712345678',
    });
  });

  it('shows moderation success + DONE after submit', async () => {
    const p = props();
    render(<ReviewModal {...p} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('SUBMIT REVIEW'));
    expect(await screen.findByText(/after a quick check/)).toBeDefined();
    fireEvent.click(screen.getByText('DONE'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('logged-in customer sees banner with mobile fallback', () => {
    render(<ReviewModal {...props({ userLabel: 'Riaz' })} />);
    expect(screen.getByText(/Reviewing as a logged-in customer/)).toBeDefined();
    fireEvent.click(screen.getByText('Use mobile number instead'));
    expect(screen.getByLabelText(/Mobile number/)).toBeDefined();
  });

  it('offers login link for guests', () => {
    render(<ReviewModal {...props()} />);
    const link = screen.getByText('Log in instead');
    expect(link.closest('a')?.getAttribute('href')).toBe('/account');
  });
});
