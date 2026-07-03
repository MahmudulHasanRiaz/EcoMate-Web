const API = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TypeError) {
    const cause = (err as any).cause;
    if (cause?.code === 'ECONNREFUSED') return true;
    if (cause?.name === 'AggregateError' && Array.isArray(cause.errors)) {
      return cause.errors.some((e: any) => e?.code === 'ECONNREFUSED');
    }
    return true;
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

  let lastError: unknown;
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
      lastError = err;
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
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

  throw lastError || new Error(`serverFetch exhausted retries for ${path}`);
}
