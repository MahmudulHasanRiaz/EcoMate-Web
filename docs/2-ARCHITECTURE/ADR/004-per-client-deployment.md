# ADR 004: Per-Client Deployment (Docker Stack) over Multi-Tenant DB

**Status:** Accepted  
**Date:** 2026-06 (Phase Prep)  
**Decider:** Lead Architect  

## Context

EcoMate supports multiple client installations. Two approaches: multi-tenant (single DB with `client_id` on every table) vs per-client (separate Docker stack per client).

## Decision

**Per-client deployment:** each client gets its own Docker stack with:
- Isolated PostgreSQL database
- Isolated Redis instance
- Isolated application instances

Multi-tenant DB considered but rejected.

## Rationale

1. **Isolation:** Client data is physically separate. No risk of cross-client data leaks.
2. **License enforcement:** Each client has its own license key. Per-client stack simplifies license binding.
3. **Upgrades:** Clients can be upgraded independently, different versions, different feature sets.
4. **Customization:** Per-client env vars, settings, branding.
5. **Simplicity:** No need for `clientId` on every table. No cross-contamination risk.

## Consequences

- **Negative:** Higher infrastructure cost (more containers per client).  
- **Negative:** More complex deployment automation (each client needs CI/CD).  
- **Negative:** Global schema migrations must be applied to all client databases.  
- **Positive:** Compliance-friendly (each client's data in separate DB).  
- **Positive:** Blast radius is one client.

## Implementation

- `clients/client-example/` — template for new client deployments
- `docs/portainer-deployment.md` — Portainer setup per stack
- `.github/workflows/deploy-client.yml` — CI workflow per-client

## Alternatives

- **Multi-tenant** — Single DB with row-level security and `client_id` on every table. Rejected due to isolation requirements and license architecture.