import { createAuthClient } from "better-auth/client";

const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/api$/, "");

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/better-auth",
});
