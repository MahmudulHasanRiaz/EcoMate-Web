# Documentation Validation Checklist

> **Status:** Final  
> **Purpose:** Every documentation file must pass these checks. If any check fails, the document must be fixed.

---

## Terminology Check

- [ ] Does the document use only canonical terms from the Business Glossary?
- [ ] Are any non-canonical terms introduced? (If yes, either add to glossary or remove)
- [ ] Are `managedStockQuantity`, `reservedStock`, `availabilityMode`, `ManagedStockLedger` used correctly?
- [ ] Is "Managed Stock" clearly distinguished from "Physical Inventory"?

## Ownership Check

- [ ] Does the document respect domain boundaries from Owns/Depends On/Does NOT Own?
- [ ] Does the document claim ownership of a capability owned by another domain?
- [ ] Does the document delegate a capability it should own?

## Consistency Check

- [ ] Does the document contradict any other document in `docs/`?
- [ ] Does the document contradict the Business Domain Contract?
- [ ] Does the document contradict any ADR in `docs/2-ARCHITECTURE/ADR/`?
- [ ] Are Superseded headers present for any historical plans referenced?

## Duplicate Concept Check

- [ ] Does the document introduce a concept that already exists elsewhere?
- [ ] Does the document redefine a term already defined in the Business Glossary?
- [ ] Is the document redundant with another document? (If yes, mark as Superseded)

## Implementation Alignment Check

- [ ] Are claims about implementation behavior verified against actual code?
- [ ] Are "Implementation Detected" claims labeled as unverified until Phase 9?
- [ ] Are any claims made about features that don't exist yet? (Move to Future)

## Obsolescence Check

- [ ] Does the document reference a plan/spec that has been superseded?
- [ ] Does the document contain information that predates the current architecture?
- [ ] Is the document's Status tag correct? (Draft / Final / Superseded)

## How to Use

1. Before creating a new doc: run through this checklist
2. Before modifying an existing doc: run through this checklist
3. During PR review of doc changes: include checklist results in review
4. For every doc in the repository: run through this checklist at least quarterly

## Violation Response

| Severity | Response |
|----------|----------|
| Contradicts BDC | Fix immediately — BDC is highest authority |
| Contradicts ADR | Fix — align with ADR or create new ADR |
| Terminology mismatch | Fix — use canonical glossary terms |
| Ownership conflict | Fix — align with domain boundaries |
| Duplicate concept | Mark as Superseded with reference to authoritative doc |
| Implementation claim wrong | Update claim or mark as "Implementation Detected (Unverified)" |
| Obsolete info | Update or mark as Superseded |