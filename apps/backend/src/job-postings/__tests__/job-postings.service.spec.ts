import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { JobPostingsService } from '../job-postings.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('JobPostingsService', () => {
  let service: JobPostingsService;
  let prisma: any;
  let featureFlags: { canUse: jest.Mock };

  const published = {
    id: 'post-1',
    slug: 'senior-qa',
    title: 'Senior QA',
    status: 'PUBLISHED',
    deadline: null,
    departmentId: null,
    designationId: null,
    location: 'Dhaka',
    employmentType: 'Full-time',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const draft = { ...published, id: 'post-2', slug: 'draft-role', status: 'DRAFT' };
  const expired = {
    ...published,
    id: 'post-3',
    slug: 'expired-role',
    deadline: new Date(Date.now() - 1000),
  };

  beforeEach(async () => {
    featureFlags = { canUse: jest.fn().mockReturnValue(true) };
    prisma = {
      department: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 'dept-1' }),
      },
      designation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'des-1' }),
      },
      jobPosting: {
        findMany: jest.fn().mockResolvedValue([published]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          ...published,
          ...data,
          id: 'post-new',
        })),
        update: jest.fn().mockImplementation(({ data }) => ({
          ...published,
          ...data,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobPostingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FeatureFlagsService, useValue: featureFlags },
      ],
    }).compile();

    service = module.get<JobPostingsService>(JobPostingsService);
  });

  describe('listPublic', () => {
    it('lists only PUBLISHED, non-expired postings', async () => {
      await service.listPublic({});
      expect(prisma.jobPosting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PUBLISHED' }),
        }),
      );
    });

    it('resolves a department slug to its id', async () => {
      prisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
      await service.listPublic({ department: 'engineering' });
      expect(prisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ id: 'engineering' }, { slug: 'engineering' }] },
        }),
      );
      expect(prisma.jobPosting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ departmentId: 'dept-1' }),
        }),
      );
    });

    it('returns an empty page for an unknown department filter', async () => {
      const res = await service.listPublic({ department: 'nope' });
      expect(res).toEqual({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      });
      expect(prisma.jobPosting.findMany).not.toHaveBeenCalled();
    });

    it('filters by employment type and location', async () => {
      await service.listPublic({ type: 'Contract', location: 'dhaka' });
      expect(prisma.jobPosting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employmentType: 'Contract',
            location: { contains: 'dhaka', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  describe('findPublicBySlug', () => {
    it('returns a published posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(published);
      await expect(service.findPublicBySlug('senior-qa')).resolves.toEqual(
        published,
      );
    });

    it('404s a DRAFT posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(draft);
      await expect(service.findPublicBySlug('draft-role')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s a posting past its deadline', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(expired);
      await expect(service.findPublicBySlug('expired-role')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create (admin)', () => {
    const dto = {
      title: 'Senior QA Engineer',
      location: 'Dhaka',
      description: 'Test things.',
    };

    it('slugifies the title and defaults to DRAFT', async () => {
      const res = await service.create(dto as any, 'user-1');
      expect(prisma.jobPosting.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'senior-qa-engineer',
            status: 'DRAFT',
            createdById: 'user-1',
          }),
        }),
      );
      expect(res.slug).toBe('senior-qa-engineer');
    });

    it('suffixes the slug on collision', async () => {
      prisma.jobPosting.findUnique
        .mockResolvedValueOnce({ id: 'other' })
        .mockResolvedValueOnce(null);
      await service.create(dto as any);
      expect(prisma.jobPosting.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'senior-qa-engineer-2' }),
        }),
      );
    });

    it('404s an unknown department', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ ...dto, departmentId: 'ghost' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects salaryMax below salaryMin', async () => {
      await expect(
        service.create({ ...dto, salaryMin: 50000, salaryMax: 40000 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses when the careers feature is absent', async () => {
      featureFlags.canUse.mockReturnValue(false);
      await expect(service.create(dto as any)).rejects.toThrow(
        'not included in your plan',
      );
    });
  });

  describe('update (admin)', () => {
    it('404s an unknown posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(null);
      await expect(
        service.update('ghost', { status: 'PUBLISHED' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('publishes a posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(published);
      await service.update('post-1', { status: 'PUBLISHED' } as any);
      expect(prisma.jobPosting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'post-1' },
          data: expect.objectContaining({ status: 'PUBLISHED' }),
        }),
      );
    });
  });
});
