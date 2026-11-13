import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { Readable } from 'stream';
import { JobApplicationsService } from '../job-applications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('JobApplicationsService', () => {
  let service: JobApplicationsService;
  let prisma: any;
  let storage: any;
  let featureFlags: { canUse: jest.Mock };

  const posting = {
    id: 'post-1',
    status: 'PUBLISHED',
    deadline: null,
  };
  const application = {
    id: 'app-1',
    jobPostingId: 'post-1',
    fullName: 'Ayesha Khan',
    email: 'ayesha@example.com',
    phone: '+8801711111111',
    coverLetter: 'Hello',
    cvUrl: 'private-local/cvs/abc.pdf',
    cvOriginalName: 'resume.pdf',
    cvDeletedAt: null,
    cvDeletedById: null,
    portfolioUrl: null,
    status: 'NEW',
    internalNote: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    featureFlags = { canUse: jest.fn().mockReturnValue(true) };
    prisma = {
      jobPosting: {
        findUnique: jest.fn().mockResolvedValue(posting),
      },
      jobApplication: {
        findMany: jest.fn().mockResolvedValue([application]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(application),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...application, ...data })),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...application, ...data })),
      },
    };
    storage = {
      storeBackupStream: jest.fn().mockResolvedValue(undefined),
      deleteBackup: jest.fn().mockResolvedValue(undefined),
      readBackupStream: jest
        .fn()
        .mockResolvedValue(Readable.from([PDF])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobApplicationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: FeatureFlagsService, useValue: featureFlags },
      ],
    }).compile();

    service = module.get<JobApplicationsService>(JobApplicationsService);
  });

  describe('apply', () => {
    const dto = {
      fullName: 'Ayesha Khan',
      email: 'ayesha@example.com',
      phone: '+8801711111111',
      coverLetter: 'Hello',
    };

    it('stores the CV in the private namespace and creates the application', async () => {
      const res = await service.apply('senior-qa', dto as any, {
        buffer: PDF,
        originalname: 'resume.pdf',
      });
      expect(res.message).toMatch('Application received');
      expect(storage.storeBackupStream).toHaveBeenCalledWith(
        expect.stringMatching(/^private-local\/cvs\/[0-9a-f-]+\.pdf$/),
        expect.any(Readable),
        'application/pdf',
      );
      expect(prisma.jobApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobPostingId: 'post-1',
            fullName: 'Ayesha Khan',
            email: 'ayesha@example.com',
            cvUrl: expect.stringMatching(/^private-local\/cvs\//),
            cvOriginalName: 'resume.pdf',
            status: 'NEW',
          }),
        }),
      );
    });

    it('never stores the user-supplied filename on disk', async () => {
      await service.apply('senior-qa', dto as any, {
        buffer: PDF,
        originalname: '../../evil.pdf',
      });
      const key = storage.storeBackupStream.mock.calls[0][0] as string;
      expect(key).not.toContain('evil');
      expect(key).not.toContain('..');
    });

    it('requires a CV', async () => {
      await expect(
        service.apply('senior-qa', dto as any, null),
      ).rejects.toThrow('CV is required');
      expect(prisma.jobApplication.create).not.toHaveBeenCalled();
    });

    it('rejects a CV whose bytes do not match a document format', async () => {
      await expect(
        service.apply('senior-qa', dto as any, {
          buffer: PNG,
          originalname: 'resume.pdf',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.storeBackupStream).not.toHaveBeenCalled();
      expect(prisma.jobApplication.create).not.toHaveBeenCalled();
    });

    it('refuses when the careers feature is absent (server-side gate)', async () => {
      featureFlags.canUse.mockReturnValue(false);
      await expect(
        service.apply('senior-qa', dto as any, {
          buffer: PDF,
          originalname: 'resume.pdf',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.storeBackupStream).not.toHaveBeenCalled();
    });

    it('refuses when only the parent admin_hr is present', async () => {
      featureFlags.canUse.mockImplementation(
        (key: string) => key === 'admin_hr',
      );
      await expect(
        service.apply('senior-qa', dto as any, {
          buffer: PDF,
          originalname: 'resume.pdf',
        }),
      ).rejects.toThrow('admin_hr_careers');
    });

    it('silently drops a honeypot-filled submission without creating anything', async () => {
      const res = await service.apply(
        'senior-qa',
        { ...dto, website: 'http://spam.example' } as any,
        { buffer: PDF, originalname: 'resume.pdf' },
      );
      expect(res.message).toMatch('Application received');
      expect(res.id).toBeUndefined();
      expect(storage.storeBackupStream).not.toHaveBeenCalled();
      expect(prisma.jobApplication.create).not.toHaveBeenCalled();
    });

    it('404s an unknown or unpublished posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue(null);
      await expect(
        service.apply('ghost', dto as any, {
          buffer: PDF,
          originalname: 'resume.pdf',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects applying to a DRAFT posting', async () => {
      prisma.jobPosting.findUnique.mockResolvedValue({
        ...posting,
        status: 'DRAFT',
      });
      await expect(
        service.apply('senior-qa', dto as any, {
          buffer: PDF,
          originalname: 'resume.pdf',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update — status workflow', () => {
    it('allows NEW → SHORTLISTED and stamps reviewer + time', async () => {
      const res = await service.update(
        'app-1',
        { status: 'SHORTLISTED', internalNote: 'Strong CV' } as any,
        'reviewer-1',
      );
      expect(prisma.jobApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1' },
          data: expect.objectContaining({
            status: 'SHORTLISTED',
            internalNote: 'Strong CV',
            reviewedById: 'reviewer-1',
            reviewedAt: expect.any(Date),
          }),
        }),
      );
      expect(res.status).toBe('SHORTLISTED');
    });

    it('rejects an illegal jump NEW → HIRED', async () => {
      await expect(
        service.update('app-1', { status: 'HIRED' } as any, 'reviewer-1'),
      ).rejects.toThrow('Cannot move an application from NEW to HIRED');
      expect(prisma.jobApplication.update).not.toHaveBeenCalled();
    });

    it('rejects any move out of REJECTED (terminal)', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue({
        ...application,
        status: 'REJECTED',
      });
      await expect(
        service.update('app-1', { status: 'INTERVIEW' } as any, 'reviewer-1'),
      ).rejects.toThrow('Cannot move an application from REJECTED');
    });
  });

  describe('deleteCv — per-application CV delete', () => {
    it('deletes the file AND the reference, and the application stays viewable', async () => {
      const res = await service.deleteCv('app-1', 'staff-1');
      expect(storage.deleteBackup).toHaveBeenCalledWith(
        'private-local/cvs/abc.pdf',
      );
      expect(prisma.jobApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1' },
          data: expect.objectContaining({
            cvUrl: null,
            cvDeletedAt: expect.any(Date),
            cvDeletedById: 'staff-1',
          }),
        }),
      );
      // The record itself is returned (not deleted) — still viewable.
      expect(res.id).toBe('app-1');
      expect(res.cvUrl).toBeNull();
      expect(res.fullName).toBe('Ayesha Khan');
    });

    it('refuses when the application has no CV', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue({
        ...application,
        cvUrl: null,
      });
      await expect(service.deleteCv('app-1', 'staff-1')).rejects.toThrow(
        'has no CV to delete',
      );
      expect(storage.deleteBackup).not.toHaveBeenCalled();
    });

    it('still clears the reference when the file is already gone', async () => {
      storage.deleteBackup.mockRejectedValueOnce(new Error('gone'));
      await expect(service.deleteCv('app-1', 'staff-1')).resolves.toMatchObject({
        id: 'app-1',
      });
      expect(prisma.jobApplication.update).toHaveBeenCalled();
    });
  });

  describe('downloadCv', () => {
    it('returns the bytes with a safe content type and the original name', async () => {
      const res = await service.downloadCv('app-1');
      expect(res.buffer).toEqual(PDF);
      expect(res.mimeType).toBe('application/pdf');
      expect(res.filename).toBe('resume.pdf');
      expect(storage.readBackupStream).toHaveBeenCalledWith(
        'private-local/cvs/abc.pdf',
      );
    });

    it('404s when the CV was deleted', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue({
        ...application,
        cvUrl: null,
      });
      await expect(service.downloadCv('app-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a cvUrl outside the private namespace', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue({
        ...application,
        cvUrl: '/uploads/evil.pdf',
      });
      await expect(service.downloadCv('app-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.readBackupStream).not.toHaveBeenCalled();
    });
  });
});
