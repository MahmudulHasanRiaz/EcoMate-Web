# ADR 006: License Guard vs Feature Guard Separation

**Status:** Accepted — **Incomplete Implementation**  
**Date:** 2026-06 (project start)  
**Decider:** Lead Architect  

## Context

Two guard systems exist for access control:

1. **LicenseGuard** — Global guard checking license validity against KeyMate API with 7-day cache
2. **FeatureGuard** — Per-feature access control using `@RequiresFeature()` decorator

The question: should these be merged or stay separate?

## Decision

**Keep them separate:**

- `LicenseGuard` (global, checks license is valid and not expired)
- `FeatureGuard` (per-route/per-controller, checks license includes the specific feature)

## Current State

- `LicenseGuard` registered as global `APP_GUARD` — ✅ working
- `FeatureGuard` exists with `@RequiresFeature('feature-name')` decorator — ✅ exists
- `@RequiresFeature()` decorator used on only 8 controllers — 🔴 **68 features in final-feature-plan.md not fully guarded**

## Gap

The feature registry (68 features from `docs/final-feature-plan.md`) describes extensive per-feature gating with UI hiding, URL protection, and error messages. Current implementation has `@RequiresFeature()` on only a subset of controllers. The full 68-feature gating system is **not implemented**.

## Consequences

- **Positive:** Clear separation of concerns (license validity vs feature access).  
- **Negative:** Missing feature guards mean unlicensed clients can access premium features. Security theater without completion.  
- **Recommendation:** Phase 9 must verify which controllers have `@RequiresFeature()` and which are missing.

## Implementation

- `packages/feature-flags/` — Feature flag engine
- `@RequiresFeature()` decorator — Per-controller feature requirement
- 8 controllers currently guarded (orders, inventory, products, purchases, etc.) — need full audit