const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function isConnRefused(err: unknown): boolean {
  if (!(err instanceof TypeError) || !(err as any).cause) return false;
  const cause = (err as any).cause;
  if (cause?.code === 'ECONNREFUSED') return true;
  if (cause?.name === 'AggregateError' && Array.isArray(cause.errors)) {
    return cause.errors.some((e: any) => e?.code === 'ECONNREFUSED');
  }
  return false;
}

export async function serverFetch<T = unknown>(
  path: string,
  options?: RequestInit & { revalidate?: number }
): Promise<T> {
  const { revalidate, ...fetchOptions } = options || {};
  const MAX_RETRIES = 3;
  const BASE_DELAY = 500;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
    } catch (err) {
      if (attempt < MAX_RETRIES && isConnRefused(err)) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        console.warn(`[serverFetch] Retry ${attempt + 1}/${MAX_RETRIES} for ${path} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`serverFetch exhausted retries for ${path}`);
}
