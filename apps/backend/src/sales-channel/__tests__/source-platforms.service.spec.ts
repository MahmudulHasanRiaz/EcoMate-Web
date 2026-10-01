/**
 * Registry seed semantics + capability filtering.
 */
import { Test } from '@nestjs/testing';
import { SourcePlatformsService } from '../source-platforms.service';
import { SOURCE_PLATFORM_SEEDS } from '../sales-channel.constants';
import { PrismaService } from '../../prisma/prisma.service';

describe('SourcePlatformsService', () => {
  let service: SourcePlatformsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      sourcePlatform: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SourcePlatformsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(SourcePlatformsService);
  });

  // ── [8] Seed must never overwrite an operator's customisation ──────────
  describe('ensureDefaults never mutates an existing row', () => {
    /**
     * A stand-in table: `createMany({skipDuplicates:true})` inserts only when
     * the slug is absent, and there is no update path at all — so if a row's
     * value changed, it could only be because the service mutated it.
     */
    function seededTable(existing: any[] = []) {
      const rows: any[] = existing.map((r) => ({ ...r }));
      return {
        rows,
        createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
          let inserted = 0;
          for (const d of data) {
            if (skipDuplicates && rows.some((r) => r.slug === d.slug)) continue;
            rows.push({ ...d });
            inserted++;
          }
          return { count: inserted };
        }),
        findMany: jest.fn(async () => rows),
        findUnique: jest.fn(async ({ where }: any) =>
          rows.find((r) => r.slug === where.slug) ?? null),
      };
    }

    async function serviceOver(existing: any[]) {
      const table = seededTable(existing);
      prisma = { sourcePlatform: table } as any;
      const moduleRef = await Test.createTestingModule({
        providers: [SourcePlatformsService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      return { svc: moduleRef.get(SourcePlatformsService), table };
    }

    it('existing row with capabilities=[] survives UNCHANGED', async () => {
      // An operator may legitimately empty capabilities to withdraw a platform
      // from a channel. [] must NOT be treated as "uncustomized".
      const { svc, table } = await serviceOver([
        { slug: 'facebook', displayName: 'Paused by ops', capabilities: [], enabled: false, sortOrder: 999 },
      ]);
      await svc.ensureDefaults();

      const fb = table.rows.find((r: any) => r.slug === 'facebook');
      expect(fb.capabilities).toEqual([]);       // untouched
      expect(fb.displayName).toBe('Paused by ops');
      expect(fb.enabled).toBe(false);
      expect(fb.sortOrder).toBe(999);
    });

    it('existing row with CUSTOM capabilities survives unchanged', async () => {
      const { svc, table } = await serviceOver([
        { slug: 'telegram', displayName: 'TG (team)', capabilities: ['MARKETING_SOURCE'], enabled: true, sortOrder: 42 },
      ]);
      await svc.ensureDefaults();

      const tg = table.rows.find((r: any) => r.slug === 'telegram');
      expect(tg.capabilities).toEqual(['MARKETING_SOURCE']); // NOT the seed's values
      expect(tg.displayName).toBe('TG (team)');
      expect(tg.sortOrder).toBe(42);
    });

    it('inserts a MISSING default row with canonical capabilities', async () => {
      const { svc, table } = await serviceOver([]);
      await svc.ensureDefaults();

      expect(table.rows).toHaveLength(SOURCE_PLATFORM_SEEDS.length);
      const fb = table.rows.find((r: any) => r.slug === 'facebook');
      expect(fb.capabilities).toContain('MESSAGING');
      expect(fb.displayName).toBe('Facebook');
      expect(fb.enabled).toBe(true);
    });

    it('issues no update at all — insertion is the only write path', async () => {
      const { svc } = await serviceOver([
        { slug: 'google', displayName: 'G', capabilities: [], enabled: true, sortOrder: 500 },
      ]);
      await svc.ensureDefaults();
      expect((prisma.sourcePlatform as any).update).toBeUndefined();
      expect((prisma.sourcePlatform as any).upsert).toBeUndefined();
    });

    it('a second ensureDefaults() does not re-add or alter anything', async () => {
      const { svc, table } = await serviceOver([]);
      await svc.ensureDefaults();
      const afterFirst = JSON.stringify(table.rows);
      await svc.ensureDefaults();
      expect(table.rows).toHaveLength(SOURCE_PLATFORM_SEEDS.length);
      expect(JSON.stringify(table.rows)).toBe(afterFirst);
    });
  });

  // ── [2]/[16] Capability filtering ───────────────────────────────────────
  describe('capability filtering', () => {
    it('queries by capability using the array containment operator', async () => {
      prisma.sourcePlatform.findMany.mockResolvedValue([]);
      await service.listByCapability('MESSAGING');
      expect(prisma.sourcePlatform.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, capabilities: { has: 'MESSAGING' } },
        }),
      );
    });

    it('excludes google from MESSAGING (GBP chat discontinued 2024-07-31)', () => {
      const google = SOURCE_PLATFORM_SEEDS.find((s) => s.slug === 'google')!;
      expect(google.capabilities).not.toContain('MESSAGING');
    });

    it('includes the initial practical messaging set', () => {
      const messaging = SOURCE_PLATFORM_SEEDS
        .filter((s) => s.capabilities.includes('MESSAGING'))
        .map((s) => s.slug);
      expect(messaging).toEqual(
        expect.arrayContaining(['facebook', 'instagram', 'whatsapp', 'tiktok', 'telegram']),
      );
    });

    it('excludes chatgpt from MESSAGING while keeping it a marketing source', () => {
      const chatgpt = SOURCE_PLATFORM_SEEDS.find((s) => s.slug === 'chatgpt')!;
      expect(chatgpt.capabilities).not.toContain('MESSAGING');
      expect(chatgpt.capabilities).toContain('MARKETING_SOURCE');
      expect(chatgpt.capabilities).toContain('AI_ASSISTANT');
    });

    it('registers tiktok and telegram for messaging even without an integration', () => {
      for (const slug of ['tiktok', 'telegram']) {
        const seed = SOURCE_PLATFORM_SEEDS.find((s) => s.slug === slug)!;
        expect(seed.capabilities).toContain('MESSAGING');
      }
    });

    it('every seed slug is unique and lowercase', () => {
      const slugs = SOURCE_PLATFORM_SEEDS.map((s) => s.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const s of slugs) expect(s).toBe(s.toLowerCase());
    });
  });

  // ── slugSet / capabilitiesFor used by the validator ────────────────────
  describe('lookup helpers', () => {
    it('slugSet returns only enabled slugs', async () => {
      prisma.sourcePlatform.findMany.mockResolvedValue([
        { slug: 'facebook', enabled: true },
        { slug: 'disabled_one', enabled: false },
      ]);
      const set = await service.slugSet();
      expect(set.has('facebook')).toBe(true);
      expect(set.has('disabled_one')).toBe(false);
    });

    it('capabilitiesFor returns null for a disabled platform', async () => {
      prisma.sourcePlatform.findUnique.mockResolvedValue({
        capabilities: ['MESSAGING'], enabled: false,
      });
      expect(await service.capabilitiesFor('facebook')).toBeNull();
    });

    it('capabilitiesFor returns null for an unknown platform', async () => {
      prisma.sourcePlatform.findUnique.mockResolvedValue(null);
      expect(await service.capabilitiesFor('nope')).toBeNull();
    });
  });
});
