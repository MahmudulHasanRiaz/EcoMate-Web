let cached: any[] | null = null;
let pending: Promise<any[]> | null = null;

export function getMenuCategories(): Promise<any[]> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/categories/menu`)
    .then(res => res.json())
    .then(data => {
      const cats = data.data || data || [];
      cached = Array.isArray(cats) ? cats : [];
      pending = null;
      return cached;
    })
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}
