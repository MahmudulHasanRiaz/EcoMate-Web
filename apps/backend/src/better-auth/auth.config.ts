import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins";
import { baPrisma } from "./prisma";

export const auth = betterAuth({
  basePath: "/api/better-auth",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",
  database: prismaAdapter(baPrisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: { modelName: "betterAuthUser" },
  account: { modelName: "betterAuthAccount" },
  session: {
    modelName: "betterAuthSession",
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  verification: { modelName: "betterAuthVerification" },
  plugins: [
    customSession(async ({ user, session }) => {
      try {
        const profile = await baPrisma.userProfile.findUnique({
          where: { betterAuthUserId: user.id },
        });
        return {
          user: { ...user, profile: profile || null },
          session,
        };
      } catch {
        return { user: { ...user, profile: null }, session };
      }
    }),
  ],
});
