Storefront MUST:
- Optimize Core Web Vitals
- Optimize LCP
- Optimize CLS
- Optimize TTFB

---

# TESTING RULES

MANDATORY TEST TYPES:

Backend:
- Unit tests
- Integration tests
- E2E tests

Frontend:
- Component tests
- E2E flows

Critical flows MUST be tested:
- Checkout
- Payment
- Inventory updates
- Order lifecycle
- Authentication
- RBAC
- Refunds

---

# DEVOPS & DEPLOYMENT RULES

Primary deployment:
- VPS + Docker

Architecture MUST ALSO remain deployable to:
- Vercel (storefront)
- Vercel or Cloudflare Pages (admin)

System MUST:
- Work in unified VPS deployment
- Work in separated deployments
- Use environment-based configuration

MANDATORY:
- Dockerized services
- Health checks
- Graceful shutdown
- Reverse proxy support
- Zero-downtime deployment readiness

Preferred:
- Traefik or Nginx
- GitHub Actions CI/CD

---

# MONOREPO RULES

Monorepo MUST:
- Share types safely
- Share validation schemas carefully
- Avoid circular dependencies
- Maintain strict boundaries

Preferred structure:
- packages/ui
- packages/types
- packages/config
- packages/utils
- packages/sdk

---

# CODE QUALITY RULES

MANDATORY:
- Strict TypeScript
- ESLint
- Prettier
- Husky
- Lint-staged

NEVER:
- Use any recklessly
- Ignore TypeScript errors
- Disable lint rules without reason

---

# DOCUMENTATION RULES

ALL major systems MUST include:
- Architecture notes
- Flow explanations
- Sequence diagrams where helpful
- Environment documentation
- Failure scenarios
- Recovery procedures

---

# AI AGENT BEHAVIOR RULES

AI agents MUST:

- Think before implementing
- Analyze scalability impact
- Analyze security impact
- Analyze database impact
- Analyze operational impact
- Analyze failure scenarios

Before coding ANY feature:
1. Evaluate architecture impact
2. Evaluate DB impact
3. Evaluate scaling impact
4. Evaluate security impact
5. Evaluate observability impact

AI agents MUST:
- Prefer maintainability over shortcuts
- Prefer explicitness over magic
- Prefer reliability over cleverness
- Prefer modularity over speed of implementation

NEVER:
- Make assumptions silently
- Introduce breaking schema changes casually
- Generate incomplete business logic
- Skip validation
- Skip authorization
- Skip error handling
- Skip logging
- Skip edge cases

---

# PRODUCTION SAFETY RULES

NEVER:
- Run destructive migrations automatically
- Delete production data casually
- Disable security for convenience
- Expose admin APIs publicly
- Store sensitive logs insecurely

MANDATORY:
- Backups
- Rollback strategy
- Migration safety checks
- Queue failure recovery
- Disaster recovery awareness

---

# FINAL QUALITY STANDARD

EcoMate is NOT a demo project.

It MUST behave like:
- Shopify-grade operational software
- Enterprise commerce infrastructure
- High-scale production system

Every implementation decision MUST prioritize:
- Reliability
- Security
- Scalability
- Maintainability
- Performance
- Operational stability

If uncertain:
- Choose the safer architecture
- Choose the more maintainable implementation
- Choose the more observable system
- Choose the more scalable design

END OF PROTOCOL