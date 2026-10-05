import { Injectable, BadRequestException } from '@nestjs/common';
import {
  PERMISSION_CATALOGUE,
  getAllCatalogueKeys,
  getCatalogueTree,
  isCatalogueKey,
  LEGACY_PERMISSION_KEYS,
} from './permission-catalogue';

@Injectable()
export class PermissionsService {
  getCatalogue() {
    return {
      groups: getCatalogueTree(),
      total: getAllCatalogueKeys().length,
    };
  }

  getKeys(): string[] {
    return getAllCatalogueKeys();
  }

  /**
   * Reject unknown permission keys on write.
   *
   * `sanitizePermissions` strips unrecognised keys at read time, so a typo used
   * to produce a preset that *looked* granted in the UI but granted nothing.
   * Failing loudly at the boundary means the admin finds out immediately.
   */
  assertKnownKeys(keys: string[] | undefined | null): void {
    if (!keys?.length) return;
    const unknown = keys.filter((k) => !isCatalogueKey(k));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}`,
      );
    }
  }

  /** Metadata for a key, or undefined when it is not grantable. */
  describe(key: string) {
    return PERMISSION_CATALOGUE.find((e) => e.key === key);
  }

  /** True for keys that predate the generated CRUD shape. */
  isLegacy(key: string): boolean {
    return (LEGACY_PERMISSION_KEYS as readonly string[]).includes(key);
  }
}