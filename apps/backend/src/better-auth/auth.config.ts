import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { customSession } from 'better-auth/plugins';
import { baPrisma } from './prisma';
import { getAllPermissions } from '../common/permissions/registry';

const secret = process.env.BETTER_AUTH_SECRET || 'dev-secret-local-fallback-2026';
if (!process.env.BETTER_AUTH_SECRET) {
  console.warn('[BA] BETTER_AUTH_SECRET not set — using dev fallback. Set in .env for production.');
}

export const auth = betterAuth({
  secret,
  basePath: '/api/better-auth',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
  database: prismaAdapter(baPrisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
    },
    github: {
      clientId: process.env.AUTH_GITHUB_ID || '',
      clientSecret: process.env.AUTH_GITHUB_SECRET || '',
    },
    facebook: {
      clientId: process.env.AUTH_FACEBOOK_ID || '',
      clientSecret: process.env.AUTH_FACEBOOK_SECRET || '',
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: {
    modelName: 'betterAuthUser',
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'customer' },
      override_permissions: { type: 'string[]', required: false },
    },
  },
  account: { modelName: 'betterAuthAccount' },
  session: {
    modelName: 'betterAuthSession',
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  verification: { modelName: 'betterAuthVerification' },
  plugins: [
    customSession(async ({ user, session }) => {
      try {
        let permissions: string[] = [];
        let customerProfileId: string | undefined;
        let employeeId: string | undefined;

        const role = (user as any).role || 'customer';
        const overridePerms: string[] =
          (user as any).override_permissions || [];

        if (role === 'employee') {
          const emp = await baPrisma.employee.findUnique({
            where: { betterAuthUserId: user.id },
            include: { accessPreset: true },
          });
          if (emp) {
            employeeId = emp.id;
            if (emp.accessPreset) {
              permissions = [...emp.accessPreset.permissions];
            }
            if (overridePerms.length > 0) {
              permissions = [...new Set([...permissions, ...overridePerms])];
            }
          }
        } else if (role === 'admin' || role === 'superadmin') {
          permissions =
            overridePerms.length > 0 ? overridePerms : getAllPermissions();
        }

        if (role === 'customer') {
          const profile = await baPrisma.customerProfile.findUnique({
            where: { betterAuthUserId: user.id },
          });
          if (profile) {
            customerProfileId = profile.id;
          }
        }

        return {
          user: {
            ...user,
            role,
            permissions,
            customerProfileId,
            employeeId,
          },
          session,
        };
      } catch (error) {
        console.error('[BA] customSession error:', error);
        return {
          user: { ...user, role: 'customer', permissions: [] },
          session,
        };
      }
    }),
  ],
});
