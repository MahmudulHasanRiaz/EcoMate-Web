'use client';

import type { BankAccount } from '@/lib/api/delivery-areas';

/**
 * Customer-facing bank transfer instructions for the Bank (manual)
 * gateway. Mirrors the manual bKash popup's "send money to this number"
 * block, but lists every configured receiving account with the NPSB
 * details a customer needs: bank, holder, account number, branch,
 * routing number and account type.
 */
export function BankAccountInstructions({ accounts }: { accounts: BankAccount[] }) {
  if (!accounts || accounts.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center">
        No bank account has been configured yet. Please contact us for bank transfer details.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((a) => (
        <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-1.5">
          <p className="text-sm font-bold text-gray-800">{a.bankName}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-gray-500">Account Holder</span>
            <span className="font-semibold text-gray-800 text-right">{a.accountHolderName}</span>
            <span className="text-gray-500">Account Number</span>
            <span className="font-bold text-gray-800 text-right font-mono">{a.accountNumber}</span>
            <span className="text-gray-500">Branch</span>
            <span className="font-semibold text-gray-800 text-right">{a.branchName}</span>
            <span className="text-gray-500">Routing Number</span>
            <span className="font-semibold text-gray-800 text-right font-mono">{a.routingNumber}</span>
            <span className="text-gray-500">Account Type</span>
            <span className="font-semibold text-gray-800 text-right">
              {a.accountType === 'SAVINGS' ? 'Savings' : 'Current'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
