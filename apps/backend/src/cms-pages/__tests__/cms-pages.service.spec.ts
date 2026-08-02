import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CmsPagesService } from '../cms-pages.service';
import { PrismaService } from '../../prisma/prisma.service';

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
  });
});
