import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BankAccountInstructions } from '../components/BankAccountInstructions';
import type { BankAccount } from '../lib/api/delivery-areas';

const accounts: BankAccount[] = [
  {
    id: 'ba-1',
    bankName: 'Dutch-Bangla Bank',
    accountHolderName: 'EcoMate Ltd',
    accountNumber: '1234567890',
    branchName: 'Motijheel',
    routingNumber: '090123456',
    accountType: 'SAVINGS',
    isActive: true,
    sortOrder: 0,
  },
  {
    id: 'ba-2',
    bankName: 'Islami Bank',
    accountHolderName: 'EcoMate Ltd',
    accountNumber: '9876543210',
    branchName: 'Dhanmondi',
    routingNumber: '125123456',
    accountType: 'CURRENT',
    isActive: true,
    sortOrder: 1,
  },
];

describe('BankAccountInstructions', () => {
  it('shows every configured account with its NPSB details', () => {
    render(<BankAccountInstructions accounts={accounts} />);
    expect(screen.getByText('Dutch-Bangla Bank')).toBeInTheDocument();
    expect(screen.getByText('Islami Bank')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText('9876543210')).toBeInTheDocument();
    expect(screen.getByText('090123456')).toBeInTheDocument();
    expect(screen.getByText('125123456')).toBeInTheDocument();
    expect(screen.getByText('Motijheel')).toBeInTheDocument();
    expect(screen.getByText('Dhanmondi')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows an empty state when no account is configured', () => {
    render(<BankAccountInstructions accounts={[]} />);
    expect(
      screen.getByText(/No bank account has been configured yet/),
    ).toBeInTheDocument();
  });
});
