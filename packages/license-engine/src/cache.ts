import * as fs from 'fs';
import * as path from 'path';
import type { LicenseInfo } from './types';

export interface CacheStore {
  get(key: string): LicenseInfo | null;
  set(key: string, value: LicenseInfo, ttlMs: number): void;
}

class FileCache implements CacheStore {
  private dir: string;
  private cache = new Map<string, { data: LicenseInfo; expiresAt: number }>();

  constructor(dir: string) {
    this.dir = dir;
    this.load();
  }

  private get filePath() {
    return path.join(this.dir, 'license-cache.json');
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.cache = new Map(Object.entries(JSON.parse(raw)));
      }
    } catch {
      this.cache = new Map();
    }
  }

  private save() {
    try {
      if (!fs.existsSync(this.dir)) {
        fs.mkdirSync(this.dir, { recursive: true });
      }
      const obj: Record<string, { data: LicenseInfo; expiresAt: number }> = {};
      this.cache.forEach((v, k) => { obj[k] = v; });
      fs.writeFileSync(this.filePath, JSON.stringify(obj), 'utf-8');
    } catch {
      // Silently fail — cache is best-effort
    }
  }

  get(key: string): LicenseInfo | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.save();
      return null;
    }
    return entry.data;
  }

  set(key: string, value: LicenseInfo, ttlMs: number) {
    this.cache.set(key, { data: value, expiresAt: Date.now() + ttlMs });
    this.save();
  }
}

export function createCache(options?: { dir?: string }): CacheStore {
  const dir = options?.dir || (
    typeof process !== 'undefined' && process.env?.HOME
      ? path.join(process.env.HOME, '.ecomate', 'cache')
      : '/tmp/ecomate-cache'
  );
  return new FileCache(dir);
}
