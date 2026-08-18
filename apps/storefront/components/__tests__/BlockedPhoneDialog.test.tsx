import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockedPhoneDialog } from '../BlockedPhoneDialog';

describe('BlockedPhoneDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <BlockedPhoneDialog open={false} onClose={() => {}} message="Blocked" />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the configured message with call + whatsapp CTAs', () => {
    render(
      <BlockedPhoneDialog
        open={true}
        onClose={() => {}}
        message="Your number is on hold. Call us."
        callNumber="+8801700000000"
        whatsapp="+8801700000000"
      />,
    );
    expect(screen.getByText('Your number is on hold. Call us.')).toBeTruthy();
    const call = screen.getByRole('link', { name: /Call Support/i });
    expect(call.getAttribute('href')).toBe('tel:+8801700000000');
    const wa = screen.getByRole('link', { name: /Chat on WhatsApp/i });
    expect(wa.getAttribute('href')).toBe('https://wa.me/8801700000000');
  });

  it('omits CTAs when no support numbers are configured', () => {
    render(
      <BlockedPhoneDialog open={true} onClose={() => {}} message="Blocked" />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(
      <BlockedPhoneDialog open={true} onClose={onClose} message="Blocked" />,
    );
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via the X button', () => {
    const onClose = vi.fn();
    render(
      <BlockedPhoneDialog open={true} onClose={onClose} message="Blocked" />,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Close' })[
        screen.getAllByRole('button', { name: 'Close' }).length - 2
      ],
    );
    expect(onClose).toHaveBeenCalled();
  });
});