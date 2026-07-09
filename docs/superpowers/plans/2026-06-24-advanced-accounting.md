# Advanced Accounting Module — Implementation Plan (TDD)
> **Superseded by:** `docs/3-DOMAINS/08-finance-hr.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> **TDD Rule:** Write failing test → implement → make pass → commit. Every service method needs test coverage.

**Goal:** Standalone double-entry accounting system with chart of accounts, opening balances, journal entries, financial periods, and reports (Trial Balance, P&L, Balance Sheet).

**Architecture:** Independent from orders/sales/purchases. User sets opening balances to start fresh. Manual journal entries only — no auto-posting. 5 account types: Asset, Liability, Equity, Income, Expense (A/L/E/I/E).

**Key Design Decisions:**
- `Account` model is hierarchical (self-referencing parentId) for chart of accounts
- `FinancialPeriod` controls which periods are open for entry
- `OpeningBalance` per account per period — allows clean start
- `JournalEntry` + `JournalEntryLine` = double-entry, enforced at service layer (total debit MUST equal total credit)
- Reports computed from JournalEntryLines, not stored separately

---
