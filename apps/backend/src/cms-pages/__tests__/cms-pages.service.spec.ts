import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CmsPagesService } from '../cms-pages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaResolverService } from '../../media/media-resolver.service';
import { templatePages } from '../template-pages';

// Invented tenant data that must never ship as a default again (storefront
// dynamic-pages round, 2026-11-13). Any default containing one of these is a
// regression: fresh tenants ship EMPTY pages.
const FORBIDDEN_DEFAULT_STRINGS = [
  'Store Limited',
  'STORE PLUS',
  'Mahmud Riaz',
  'C-182394/2021',
  'BSTI Certified',
  'FIXED PLUS LTD',
  '150+ Experts',
  'Chittagong Store',
  'Sylhet Store',
  'Opening 2025',
  'January 2024',
  'December 2024',
  'Get the Store App',
];

describe('CmsPagesService', () => {
  let service: CmsPagesService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsPagesService,
        {
          provide: PrismaService,
          useValue: {
            cmsPage: {
              findUnique: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'x', ...data })),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'x', ...data })),
              delete: jest.fn().mockResolvedValue({ message: 'Page deleted' }),
            },
            systemSetting: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: MediaResolverService,
          useValue: { resolve: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<CmsPagesService>(CmsPagesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('ensureTemplatePages', () => {
    it('creates template rows for every registry entry', async () => {
      await service.ensureTemplatePages();
      expect(prisma.cmsPage.create).toHaveBeenCalledTimes(13);
      const calls = (prisma.cmsPage.create as jest.Mock).mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(calls.every((d: any) => d.type === 'template')).toBe(true);
      expect(calls.some((d: any) => d.slug === 'careers')).toBe(true);
      expect(calls.some((d: any) => d.templateKey === 'contact')).toBe(true);
    });

    it('is idempotent — skips pages that already exist', async () => {
      (prisma.cmsPage.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
        Promise.resolve(where?.slug === 'careers' ? { id: 'existing', slug: 'careers' } : null),
      );
      await service.ensureTemplatePages();
      const creates = (prisma.cmsPage.create as jest.Mock).mock.calls.map(
        (c: any[]) => c[0].data.slug,
      );
      expect(creates).toHaveLength(12);
      expect(creates).not.toContain('careers');
    });

    it('seeds only tenant-neutral empty defaults — no invented tenant data', async () => {
      await service.ensureTemplatePages();
      const calls = (prisma.cmsPage.create as jest.Mock).mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(calls).toHaveLength(13);
      for (const d of calls) {
        const json = JSON.stringify(d.config);
        for (const forbidden of FORBIDDEN_DEFAULT_STRINGS) {
          expect(json).not.toContain(forbidden);
        }
      }
      // Spot-check the neutral shapes: no fake jobs, stores, or policy copy.
      const bySlug = new Map(calls.map((d: any) => [d.slug, d.config]));
      expect(bySlug.get('careers').jobs).toEqual([]);
      expect(bySlug.get('stores').stores).toEqual([]);
      expect(bySlug.get('faq').items).toEqual([]);
      expect(bySlug.get('terms-conditions').sections).toEqual([]);
      expect(bySlug.get('shipping-policy').deliveryCharge).toBe(0);
    });
  });

  describe('templatePages defaults', () => {
    it('contain no invented tenant data in any default config', () => {
      expect(templatePages).toHaveLength(13);
      const offenders: string[] = [];
      for (const def of templatePages) {
        const json = JSON.stringify(def.defaultConfig);
        for (const forbidden of FORBIDDEN_DEFAULT_STRINGS) {
          if (json.includes(forbidden)) offenders.push(`${def.key} contains "${forbidden}"`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('findBySlug', () => {
    it('throws 404 for an inactive page', async () => {
      (prisma.cmsPage.findUnique as jest.Mock).mockResolvedValue({
        id: 'x',
        slug: 'privacy-policy',
        isActive: false,
      });
      await expect(service.findBySlug('privacy-policy')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an active page', async () => {
      const page = { id: 'x', slug: 'faq', isActive: true, config: {} };
      (prisma.cmsPage.findUnique as jest.Mock).mockResolvedValue(page);
      await expect(service.findBySlug('faq')).resolves.toEqual(page);
    });

    it('rewrites embedded original-upload images to derivatives (public path)', async () => {
      const page = {
        id: 'x',
        slug: 'about',
        isActive: true,
        content: '<p>Hi</p><img src="/uploads/banner.jpg" alt="Banner">',
      };
      (prisma.cmsPage.findUnique as jest.Mock).mockResolvedValue(page);
      const resolver = (service as any).mediaResolver as MediaResolverService;
      (resolver.resolve as jest.Mock).mockResolvedValue({
        '/uploads/banner.jpg': {
          derivativeManifest: {
            small: '/uploads/derivatives/m1/small.webp',
            medium: '/uploads/derivatives/m1/medium.webp',
            large: '/uploads/derivatives/m1/large.webp',
          },
          blurUrl: null,
          updatedAt: new Date(),
        },
      });
      const result: any = await service.findBySlug('about');
      expect(result.content).toContain('src="/uploads/derivatives/m1/large.webp"');
      expect(result.content).toContain('srcset=');
      expect(result.content).toContain('loading="lazy"');
      // The stored row object is not mutated.
      expect(page.content).toContain('src="/uploads/banner.jpg"');
    });

    it('attaches derivative manifests for structured config image fields (public path)', async () => {
      const page = {
        id: 'x',
        slug: 'about',
        isActive: true,
        content: '<p>Hi</p>',
        config: { image: '/uploads/hero.png', hero: { image: '/uploads/hero2.png' }, title: 'About' },
      };
      (prisma.cmsPage.findUnique as jest.Mock).mockResolvedValue(page);
      const resolver = (service as any).mediaResolver as MediaResolverService;
      (resolver.resolve as jest.Mock).mockResolvedValue({
        '/uploads/hero.png': {
          derivativeManifest: { large: '/uploads/derivatives/m9/large.webp' },
          blurUrl: null,
          updatedAt: new Date(),
        },
      });
      const result: any = await service.findBySlug('about');
      expect(resolver.resolve).toHaveBeenCalledWith(
        expect.arrayContaining(['/uploads/hero.png', '/uploads/hero2.png']),
      );
      expect(result.config._mediaMeta['/uploads/hero.png'].derivativeManifest.large).toBe(
        '/uploads/derivatives/m9/large.webp',
      );
      // Stored config object is not mutated.
      expect((page.config as any)._mediaMeta).toBeUndefined();
    });

    it('leaves content untouched when no derivatives exist yet', async () => {
      const page = {
        id: 'x',
        slug: 'about',
        isActive: true,
        content: '<img src="/uploads/banner.jpg">',
      };
      (prisma.cmsPage.findUnique as jest.Mock).mockResolvedValue(page);
      const result: any = await service.findBySlug('about');
      expect(result.content).toBe(page.content);
    });
  });
});
