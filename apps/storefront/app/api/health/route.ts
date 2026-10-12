import { NextResponse } from 'next/server';

// Liveness probe for container orchestration (Docker/Portainer healthcheck).
// Static, dependency-free, never touches the backend — answers even when the
// API is down, so the check reflects THIS container, not the whole stack.
export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
