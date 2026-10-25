import { NextResponse } from 'next/server';

// CSP violation collector for the report-only policy (F22, 2026-10-25).
// Reports arrive from browsers when a page would violate the policy; the
// policy itself blocks nothing yet, so these logs are the evidence base
// for tightening it into an enforcing policy later.
// Flood guard: at most 100 reports/minute are logged; the rest still get
// a 204 (never let a report flood become a log flood).
let windowStart = 0;
let loggedInWindow = 0;

export async function POST(request: Request) {
  try {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      loggedInWindow = 0;
    }
    const raw = await request.text();
    if (loggedInWindow < 100) {
      loggedInWindow++;
      console.warn('[csp-report]', raw.slice(0, 2048));
    }
  } catch {
    // Never fail on a report.
  }
  return new NextResponse(null, { status: 204 });
}
