import { createHash } from 'node:crypto';

/**
 * TrackingNormalizer — the ONE place SHA-256 hashing/normalization lives
 * (design §4.5). Injected into every provider adapter; no adapter implements
 * its own hashing or normalization. A provider rule change = edit this file.
 *
 * Rules are Meta-compatible with browser-side Advanced Matching:
 *  - email: trim + lowercase before SHA-256; synthetic emails are dropped.
 *  - phone: always yields E.164-with-country-code (BD local → 880…), never a
 *    bare local number.
 *  - name: lowercase, punctuation stripped.
 *  - zip: de-dash/de-space, US ZIP+4 truncated to first 5 digits.
 *  - country: lowercase ISO alpha-2.
 */
export class TrackingNormalizer {
  /** Bump when normalization rules change; recorded in configSnapshot and pinned by replay. */
  readonly version = 1;

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Trim → lowercase → SHA-256. Undefined for empty/synthetic emails. */
  hashEmail(email: string): string | undefined {
    const normalized = email.trim().toLowerCase();
    if (!normalized || this.isSyntheticEmail(normalized)) return undefined;
    return this.sha256(normalized);
  }

  /**
   * Strip non-digits/`+`. Local number (10 digits) is resolved to a country
   * code only for BD (→ 880…); an already-coded E.164 number (11-15 digits)
   * is left as-is. Never emits a bare local number.
   */
  hashPhone(phone: string, countryCode?: string): string | undefined {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return undefined;
    // E.164 never starts with a trunk '0' — drop a domestic prefix if present.
    const withoutTrunk = digits.startsWith('0') ? digits.slice(1) : digits;
    if (withoutTrunk.length === 10) {
      if (countryCode?.toUpperCase() === 'BD') {
        return this.sha256(`880${withoutTrunk}`);
      }
      return undefined; // bare local number, country unresolved
    }
    if (withoutTrunk.length >= 11 && withoutTrunk.length <= 15) {
      return this.sha256(withoutTrunk); // already carries a country code
    }
    return undefined;
  }

  /** Lowercase, strip punctuation (Unicode-aware, keeps letters/numbers/space). */
  hashName(name: string): string | undefined {
    const normalized = name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
    if (!normalized) return undefined;
    return this.sha256(normalized);
  }

  hashCity(city: string): string | undefined {
    const normalized = city.trim().toLowerCase();
    return normalized ? this.sha256(normalized) : undefined;
  }

  hashState(state: string): string | undefined {
    const normalized = state.trim().toLowerCase();
    return normalized ? this.sha256(normalized) : undefined;
  }

  hashZip(zip: string): string | undefined {
    const normalized = this.normalizeZip(zip);
    return normalized ? this.sha256(normalized) : undefined;
  }

  /** Lowercase ISO alpha-2. */
  hashCountry(country: string): string | undefined {
    const normalized = country.trim().toLowerCase();
    return normalized ? this.sha256(normalized) : undefined;
  }

  hashExternalId(id: string): string | undefined {
    const normalized = id.trim().toLowerCase();
    return normalized ? this.sha256(normalized) : undefined;
  }

  /**
   * True when the email should never reach a provider: empty, no domain,
   * system-generated `cust_` prefix, all-numeric local part, or a `+` tag
   * (Meta treats `name+tag@…` as invalid).
   */
  isSyntheticEmail(email: string): boolean {
    const trimmed = email.trim();
    if (!trimmed) return true;
    const at = trimmed.lastIndexOf('@');
    if (at < 0) return true; // no domain → not a real address
    const local = trimmed.slice(0, at).toLowerCase();
    if (local.startsWith('cust_')) return true;
    if (/^\d+$/.test(local)) return true;
    if (local.includes('+')) return true;
    return false;
  }

  /** Last token is lastName; the rest is firstName. Single token → firstName only. */
  splitName(fullName: string): { firstName?: string; lastName?: string } {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: undefined, lastName: undefined };
    if (parts.length === 1) return { firstName: parts[0], lastName: undefined };
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
    };
  }

  /** Raw-normalized zip (unhashed): lowercase, de-dash/de-space, US first-5. */
  normalizeZip(zip: string): string {
    const clean = zip.toLowerCase().replace(/[\s-]/g, '');
    // Any all-digit code longer than 5 is treated as US ZIP/ZIP+4 → first 5.
    return /^\d{6,}$/.test(clean) ? clean.slice(0, 5) : clean;
  }
}
