import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; platform: string }> },
) {
  const { token, platform } = await params
  const backendUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/feeds/catalog/${token}/${platform}`
  return NextResponse.redirect(backendUrl, 302)
}
