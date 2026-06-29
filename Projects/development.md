# Development Guide

## 1. Local Setup

### KeyMate

```bash
cd KeyMate-2/backend

# Install Ruby 3.x (via rbenv/rvm)
bundle install

# Setup PostgreSQL database
createdb keygen_development

# Copy env and configure
cp .env.example .env
# Edit DATABASE_URL for local PostgreSQL

# Run setup (creates account, runs migrations)
bundle exec rake keygen:setup

# Seed EcoMate product data (59 entitlements, 8 plans)
bundle exec rake keygen:seed_products

# Start development server
bundle exec rails server -p 8080
```

### EcoMate Backend

```bash
cd "EcoMate Web/apps/backend"

# Install Node.js 18+ via nvm
npm install

# Setup PostgreSQL database
createdb ecomate_web

# Copy env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET

# Run Prisma migrations
npx prisma generate
npx prisma migrate dev

# Start in watch mode
npm run start:dev
```

### EcoMate Frontends

```bash
# Storefront (Next.js)
cd "EcoMate Web/apps/storefront"
npm install
cp .env.example .env.local
npm run dev

# Admin panel (Next.js)
cd "EcoMate Web/apps/admin"
npm install
cp .env.example .env.local
npm run dev
```

## 2. Running Tests

### EcoMate (Jest)

```bash
# All tests
npx jest

# Specific file
npx jest apps/backend/src/gateways/__tests__/gateway-config.controller.spec.ts

# Watch mode
npx jest --watch

# Coverage
npx jest --coverage
```

EcoMate test files follow the pattern `__tests__/*.spec.ts` co-located with source.

### KeyMate (RSpec + Cucumber)

```bash
cd KeyMate-2/backend

# IMPORTANT: Always use the rake test harness, never invoke rspec directly.
# See AGENTS.md for full details on test execution rules.

# All tests
KEYGEN_EDITION=CE KEYGEN_MODE=singleplayer bundle exec rake test

# Targeted RSpec
KEYGEN_EDITION=CE KEYGEN_MODE=singleplayer bundle exec rake test:rspec[spec/models/license_spec.rb]

# Targeted Cucumber
KEYGEN_EDITION=CE KEYGEN_MODE=singleplayer bundle exec rake test:cucumber[features/api/v1/licenses]

# EE-specific tests
KEYGEN_EDITION=EE KEYGEN_MODE=singleplayer bundle exec rake test:rspec[spec/models/license_spec.rb]

# With Clickhouse (analytics/logs)
CLICKHOUSE_DATABASE_ENABLED=1 KEYGEN_EDITION=EE KEYGEN_MODE=multiplayer \
  bundle exec rake test:rspec[spec/workers/record_machine_sparks_worker_spec.rb]
```

Test naming conventions:
- RSpec: `spec/**/*_spec.rb`
- Cucumber: `features/**/*.feature`
- Edition tags: `@ee` / `@ce` (Cucumber), `:only_ee` / `:only_ce` (RSpec)
- Mode tags: `@mp` / `@sp` (Cucumber), `only: :mp` / `only: :sp` (RSpec)

## 3. How to Add a New Feature Flag

### Step 1: Add entitlement in KeyMate

Edit `KeyMate-2/backend/lib/tasks/keygen/seed_products.rake`:

```ruby
# Add to the appropriate tier array
essential_codes = %w[
  existing_codes
  new_feature_code    # <-- add here
]
```

### Step 2: Seed the new entitlement

```bash
cd KeyMate-2/backend
bundle exec rake keygen:seed_products
```

### Step 3: Gate the controller in EcoMate

```typescript
// Method-level gating
@RequiresFeature('new_feature_code')
@Get()
async getData() { ... }

// Class-level gating
@RequiresFeature('new_feature_code')
@Controller('data')
export class DataController { ... }
```

### Step 4: Write tests

```typescript
// EcoMate test
import { FeatureGuard } from '@ecomate/feature-flags';

describe('FeatureGuard', () => {
  it('allows access when feature is present', () => {
    // Verify guard returns true for matching feature
  });

  it('blocks access when feature is missing', () => {
    // Verify guard returns false for absent feature
  });
});
```

```ruby
# KeyMate test (if entitlement logic changed)
KEYGEN_EDITION=CE KEYGEN_MODE=singleplayer \
  bundle exec rake test:rspec[spec/models/entitlement_spec.rb]
```

### Step 5: Assign to a plan

Via admin UI or seed data:
```ruby
Saas::PlanEntitlement.create!(plan: plan, entitlement: entitlement, price: 0)
```

## 4. Common Troubleshooting

### "KeyMate unreachable" on EcoMate startup
- Verify `KEYMATE_API_URL` is correct in `.env`
- Check network: `curl https://keygen-keymate.commercians.com/v1/saas/licenses/verify`
- Ensure KeyMate server is running
- Fallback: set `LICENSE_TOKEN` with pre-verified JSON data

### "license_not_found" from KeyMate
- Verify license key exists: check KeyMate admin panel
- Check that the API key token has `license.validate` permission
- Confirm `KEYGEN_ACCOUNT_ID` matches the account where the license was created

### Prisma migration fails
```bash
npx prisma generate
npx prisma migrate reset   # resets data
npx prisma migrate dev     # applies pending migrations
```

### Ruby build fails on macOS
```bash
# Ensure OpenSSL is available
brew install openssl
bundle config build.openssl --with-openssl-dir=$(brew --prefix openssl)
bundle install
```

### PostgreSQL connection refused
```bash
# Check if PostgreSQL is running
brew services list | grep postgresql
brew services start postgresql@16
```

### License Engine cache issues
```bash
# Clear file cache
rm -rf ~/.ecomate/cache/license-cache.json

# Or for production deployments
rm -rf /home/deploy/.ecomate/cache/
```
