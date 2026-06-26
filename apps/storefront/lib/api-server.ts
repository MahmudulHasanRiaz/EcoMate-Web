const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export async function serverFetch<T = unknown>(
  path: string,
  options?: RequestInit & { revalidate?: number }
): Promise<T> {
  const { revalidate, ...fetchOptions } = options || {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...(revalidate !== undefined ? { next: { revalidate } } : {}),
      signal: controller.signal,
      ...fetchOptions,
    });
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}
