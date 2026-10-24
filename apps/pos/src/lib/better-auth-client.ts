import { createAuthClient } from "better-auth/client";

// Same-origin by default: the POS origin proxies /api/* to the backend
// (VITE_API_URL defaults to /api), so auth calls belong on this origin.
// The old localhost fallback fired whenever VITE_BETTER_AUTH_URL was not
// baked into the build — pointing staff browsers at http://localhost:4000,
// which both breaks sign-in and makes Chrome demand the Local Network
// Access permission. An explicit VITE_BETTER_AUTH_URL still wins.
const baseURL =
  import.meta.env.VITE_BETTER_AUTH_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:4000");

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/better-auth",
});
