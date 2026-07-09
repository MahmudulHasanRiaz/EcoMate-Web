# Finance & HR Domain

> **Status:** Draft  

## Models

- `Employee` — Staff accounts and roles
- `Payroll` — Salary and payment records
- `Accounting` / `Account` — Financial transaction records
- `Payment` / `Refund` — Payment processing records
- `Expense` / `ExpenseCategory` — Operational expenses
- `FinancialPeriod` — Accounting period management

## Owns

- Employee management
- Payroll processing
- Accounting (double-entry bookkeeping)
- Chart of Accounts
- Payment gateway configurations
- Payment and refund processing
- Expense tracking
- Financial periods
- COGS calculation (from cost snapshots and costing lots)

## Depends On

- **Orders** — Payments are for orders; refunds reference order items
- **Purchases** — Expenses from purchases feed accounting
- **Inventory** — Costing lots feed Actual COGS calculation

## Does NOT Own

- Product catalog or pricing
- Managed Stock or Physical Inventory
- Order lifecycle
- Sales or marketing campaigns