const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export async function serverFetch<T = unknown>(
  path: string,
  options?: RequestInit & { revalidate?: number }
): Promise<T> {
  const { revalidate, ...fetchOptions } = options || {};
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...(revalidate !== undefined ? { next: { revalidate } } : {}),
    ...fetchOptions,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}
