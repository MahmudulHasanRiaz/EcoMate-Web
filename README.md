# EcoMate

Advanced E-commerce Site with Monorepo Architecture.

## Project Structure

- `apps/admin`: Admin Panel (React SPA + Vite + TanStack) - Based on [shadcn-admin](https://github.com/satnaing/shadcn-admin)
- `apps/storefront`: Storefront (Next.js 16.2.6)
- `apps/backend`: Backend API (NestJS)

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development servers:
   - Admin: `npm run admin:dev`
   - Storefront: `npm run storefront:dev`
   - Backend: `npm run backend:dev`
