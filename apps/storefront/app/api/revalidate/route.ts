import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";

// On-demand cache invalidation (Speed Plan P4).
//
// The backend (or an operator with curl) calls this after a product or
// storefront-config mutation so the change is reflected immediately
// instead of waiting out the fetch revalidate windows / edge TTLs:
//
//   curl -X POST https://<store>/api/revalidate \
//     -H "x-revalidation-secret: $REVALIDATION_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"tags":["products"]}'
//
// Tags may also be given as ?tag=products (repeatable) or
// ?tags=products,config. Only the allowlisted tags below exist — the
// endpoint is not a generic revalidation oracle.
//
// Guard: the shared secret comes from the REVALIDATION_SECRET env var
// (server-only, never NEXT_PUBLIC_). When it is unset the endpoint is
// DISABLED — every call gets 401 — so a deployment that never opted in
// has no open invalidation endpoint. The CDN edge cache is NOT purged by
// this call (Next cannot purge Cloudflare); edge copies expire within
// the short s-maxage/SWR windows set in next.config.ts.
export const dynamic = "force-dynamic";

const ALLOWED_TAGS = ["products", "config"] as const;
type AllowedTag = (typeof ALLOWED_TAGS)[number];

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; the early length check
  // leaks only the secret's length, never its content.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function providedSecret(request: Request): string | null {
  const headerSecret = request.headers.get("x-revalidation-secret");
  if (headerSecret) return headerSecret;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return null;
}

async function requestedTags(request: Request): Promise<string[]> {
  const tags = new Set<string>();
  const url = new URL(request.url);
  for (const tag of url.searchParams.getAll("tag")) tags.add(tag);
  for (const tag of url.searchParams.get("tags")?.split(",") ?? []) {
    if (tag.trim()) tags.add(tag.trim());
  }
  try {
    const body = (await request.json()) as { tags?: unknown; tag?: unknown };
    const bodyTags = [
      ...(Array.isArray(body?.tags) ? body.tags : []),
      ...(typeof body?.tag === "string" ? [body.tag] : []),
    ];
    for (const tag of bodyTags) {
      if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
    }
  } catch {
    // No/invalid JSON body — query params alone are a valid call shape.
  }
  return [...tags];
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { revalidated: false, message: "Revalidation is not configured" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!secretMatches(providedSecret(request), secret)) {
    return NextResponse.json(
      { revalidated: false, message: "Invalid or missing secret" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const requested = await requestedTags(request);
  const valid = requested.filter((t): t is AllowedTag =>
    (ALLOWED_TAGS as readonly string[]).includes(t),
  );
  if (valid.length === 0) {
    return NextResponse.json(
      {
        revalidated: false,
        message: `No valid tag supplied. Allowed tags: ${ALLOWED_TAGS.join(", ")}`,
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  for (const tag of valid) {
    // External caller (webhook pattern): expire immediately instead of
    // serving stale-while-revalidate, so a product edit is visible on the
    // next request, not eventually.
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json(
    { revalidated: true, tags: valid, now: Date.now() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
