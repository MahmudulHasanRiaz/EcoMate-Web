import { createAuthClient } from "better-auth/client";

const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || origin,
  basePath: "/api/better-auth",
});
