# ADR 005: C++ N-API Addon for License Validation (vs Pure JS)

**Status:** Accepted — with caveat  
**Date:** 2026-06 (project start)  
**Decider:** Lead Architect  

## Context

EcoMate requires offline-verifiable license validation with cryptographic signing. Options: pure JS crypto, native C++ addon for obfuscation, or external validation service.

## Decision

**C++ N-API addon** (`packages/license-engine/`) for core crypto operations, specifically Ed25519 signature verification:

- Binary `.node` file harder to reverse than JS
- Can be obfuscated at build time via `javascript-obfuscator`
- N-API is stable across Node.js versions

## Current State

**Implementation Detected (Unverified):**
- C++ addon exists at `packages/license-engine/`
- `VerifyEd25519()` function exists
- Stub detection: `VerifyEd25519()` currently **always returns true** — cryptographic validation not yet wired to real KeyMate API

## Concerns

🔴 The addon provides security theater if `VerifyEd25519()` always returns true. The actual license validation comes from the 7-day cache + KeyMate API call in the LicenseService, not from cryptographic signature verification.

## Consequences

- **Positive:** Obfuscation harder to bypass than pure JS.  
- **Negative:** `node-gyp` build dependency. Increases build complexity.  
- **Negative:** Addon is not actually doing crypto yet (STUB).  
- **Negative:** Adds ~50ms to first startup for native addon loading.

## Recommendation

Either implement real Ed25519 verification in the addon, or remove the C++ layer and rely on KeyMate API + 7-day cache for license validation.