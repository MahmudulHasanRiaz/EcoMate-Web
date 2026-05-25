export function formatPrice(price: number | string, symbol = "৳"): string {
  const num = typeof price === "string" ? parseFloat(price) : price;
  return symbol + Number(num.toFixed(2)).toLocaleString("en-BD");
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

