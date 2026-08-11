/**
 * Canonical Bangladesh district → division resolver (spec §19-21).
 *
 * Single authoritative mapping for the whole monorepo: storefront, backend
 * orders, POS, admin and tracking all resolve districts through this one
 * table. Keyed on the project's canonical district names (delivery-areas
 * BD_DISTRICTS), with a small alias map for common spelling variants so that
 * both "Chattogram" and "Chittagong" resolve identically.
 *
 * Directories follow official 8-division names (BD_DIVISIONS in
 * bd-districts.ts): Dhaka, Chittagong, Rajshahi, Khulna, Barisal, Sylhet,
 * Rangpur, Mymensingh. New orders persist the resolved division into
 * shippingAddress JSON; historical orders (no division) are lazily resolved
 * at tracking/read time — never a DB backfill.
 */

export const BD_DIVISIONS = [
  'Dhaka',
  'Chittagong',
  'Rajshahi',
  'Khulna',
  'Barisal',
  'Sylhet',
  'Rangpur',
  'Mymensingh',
] as const;

export type BDDivision = (typeof BD_DIVISIONS)[number];

/**
 * district -> division. Keys are the project's canonical English district
 * names; all 64 districts are present (one entry each, no duplicates).
 * Added as `@@`-stable plain object so it is directly importable by the
 * delivery-areas module and the tracking/orders services without a cycle.
 */
export const DISTRICT_TO_DIVISION: Readonly<Record<string, BDDivision>> = {
  // Dhaka division (13)
  Dhaka: 'Dhaka',
  Faridpur: 'Dhaka',
  Gazipur: 'Dhaka',
  Gopalganj: 'Dhaka',
  Kishoreganj: 'Dhaka',
  Madaripur: 'Dhaka',
  Manikganj: 'Dhaka',
  Munshiganj: 'Dhaka',
  Narayanganj: 'Dhaka',
  Narsingdi: 'Dhaka',
  Rajbari: 'Dhaka',
  Shariatpur: 'Dhaka',
  Tangail: 'Dhaka',
  // Chittagong division (11)
  Bandarban: 'Chittagong',
  Brahmanbaria: 'Chittagong',
  Chandpur: 'Chittagong',
  Chittagong: 'Chittagong',
  Comilla: 'Chittagong',
  "Cox's Bazar": 'Chittagong',
  Feni: 'Chittagong',
  Khagrachari: 'Chittagong',
  Lakshmipur: 'Chittagong',
  Noakhali: 'Chittagong',
  Rangamati: 'Chittagong',
  // Rajshahi division (8)
  Bogura: 'Rajshahi',
  Chapainawabganj: 'Rajshahi',
  Joypurhat: 'Rajshahi',
  Naogaon: 'Rajshahi',
  Natore: 'Rajshahi',
  Pabna: 'Rajshahi',
  Rajshahi: 'Rajshahi',
  Sirajganj: 'Rajshahi',
  // Khulna division (10)
  Bagerhat: 'Khulna',
  Chuadanga: 'Khulna',
  Jashore: 'Khulna',
  Jhenaidah: 'Khulna',
  Khulna: 'Khulna',
  Kushtia: 'Khulna',
  Magura: 'Khulna',
  Meherpur: 'Khulna',
  Narail: 'Khulna',
  Satkhira: 'Khulna',
  // Barisal division (6)
  Barguna: 'Barisal',
  Barisal: 'Barisal',
  Bhola: 'Barisal',
  Jhalokati: 'Barisal',
  Patuakhali: 'Barisal',
  Pirojpur: 'Barisal',
  // Sylhet division (4)
  Habiganj: 'Sylhet',
  Moulvibazar: 'Sylhet',
  Sunamganj: 'Sylhet',
  Sylhet: 'Sylhet',
  // Rangpur division (8)
  Dinajpur: 'Rangpur',
  Gaibandha: 'Rangpur',
  Kurigram: 'Rangpur',
  Lalmonirhat: 'Rangpur',
  Nilphamari: 'Rangpur',
  Panchagarh: 'Rangpur',
  Rangpur: 'Rangpur',
  Thakurgaon: 'Rangpur',
  // Mymensingh division (4)
  Jamalpur: 'Mymensingh',
  Mymensingh: 'Mymensingh',
  Netrokona: 'Mymensingh',
  Sherpur: 'Mymensingh',
};

/**
 * Common spelling variants (official Gazette vs project delivery-areas names).
 * Both forms resolve; the canonical project spelling is the primary key above.
 */
const DISTRICT_ALIASES: Readonly<Record<string, string>> = {
  Chattogram: 'Chittagong',
  Cumilla: 'Comilla',
  Barishal: 'Barisal',
  Jhalokathi: 'Jhalokati',
  Khagrachhari: 'Khagrachari',
  Khagrachory: 'Khagrachari',
};

function normalizeDistrict(district: string): string {
  return district.trim().replace(/\s+/g, ' ');
}

/** Canonical division for a district (project spelling), or undefined on miss. */
export function resolveDivision(
  district?: string | null,
): BDDivision | undefined {
  if (!district) return undefined;
  const key = normalizeDistrict(district);

  // Exact project-spelling key first (fast path).
  const exact = DISTRICT_TO_DIVISION[key];
  if (exact) return exact;

  // Official-spelling alias -> canonical district -> division.
  const aliasTarget = DISTRICT_ALIASES[key];
  if (aliasTarget) return DISTRICT_TO_DIVISION[aliasTarget];

  // Case-insensitive scan (handles `dhaka`, `COX'S BAZAR`, etc.) over both the
  // canonical keys and the aliases — still fully single-sourced.
  const lower = key.toLowerCase();
  for (const [name, division] of Object.entries(DISTRICT_TO_DIVISION)) {
    if (name.toLowerCase() === lower) return division;
  }
  for (const [alias, name] of Object.entries(DISTRICT_ALIASES)) {
    if (alias.toLowerCase() === lower) return DISTRICT_TO_DIVISION[name];
  }
  return undefined;
}

/** True when the district is a known Bangladesh district (project list). */
export function isKnownDistrict(district?: string | null): boolean {
  if (!district) return false;
  return resolveDivision(district) !== undefined;
}