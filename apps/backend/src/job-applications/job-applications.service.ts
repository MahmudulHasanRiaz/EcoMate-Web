import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { assertCareersFeature } from '../job-postings/careers-feature';
import {
  cvDownloadFilename,
  cvMimeTypeForKey,
  cvStorageKey,
  sanitizeCvOriginalName,
  validateCvBuffer,
} from './cv-file';
import { ApplyJobDto } from './dto/apply-job.dto';
import { UpdateJobApplicationDto } from './dto/update-job-application.dto';

const MAX_PER_PAGE = 100;

/** Allowed status transitions. REJECTED and HIRED are terminal. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['HIRED', 'REJECTED'],
  REJECTED: [],
  HIRED: [],
};

function toPage(value?: string): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toPerPage(value?: string): number {
  const n = parseInt(value ?? '20', 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, MAX_PER_PAGE);
}

@Injectable()
export class JobApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ── Public apply ────────────────────────────────────────────────────────
  // The feature gate is enforced HERE, server-side: the storefront's flag
  // check is cosmetic and a direct POST must not bypass it.

  async apply(
    slug: string,
    dto: ApplyJobDto,
    cv: { buffer: Buffer; originalname: string } | null,
  ): Promise<{ id?: string; message: string }> {
    assertCareersFeature(this.featureFlags);

    // Honeypot filled → bot. Return the success shape without persisting
    // anything, so the bot learns nothing.
    if (dto.website && dto.website.trim() !== '') {
      return { message: 'Application received. Thank you!' };
    }

    const posting = await this.prisma.jobPosting.findUnique({
      where: { slug },
      select: { id: true, status: true, deadline: true },
    });
    if (!posting) throw new NotFoundException('Job posting not found');
    if (posting.status !== 'PUBLISHED') {
      throw new NotFoundException('Job posting not found');
    }
    if (posting.deadline && posting.deadline <= new Date()) {
      throw new BadRequestException('Applications for this role are closed');
    }

    if (!cv) throw new BadRequestException('CV is required');
    const { ext, mimeType } = validateCvBuffer(cv.buffer, cv.originalname);

    const key = cvStorageKey(ext);
    try {
      await this.storage.storeBackupStream(
        key,
        Readable.from(cv.buffer),
        mimeType,
      );
    } catch (err) {
      throw new BadRequestException(
        `Could not store CV: ${(err as Error).message}`,
      );
    }

    try {
      const created = await this.prisma.jobApplication.create({
        data: {
          jobPostingId: posting.id,
          fullName: dto.fullName.trim(),
          email: dto.email.trim().toLowerCase(),
          phone: dto.phone.trim(),
          coverLetter: dto.coverLetter?.trim() || null,
          cvUrl: key,
          cvOriginalName: sanitizeCvOriginalName(cv.originalname),
          portfolioUrl: dto.portfolioUrl?.trim() || null,
          status: 'NEW',
        },
        select: { id: true },
      });
      return {
        id: created.id,
        message: 'Application received. Thank you!',
      };
    } catch (err) {
      // Do not strand the stored file when the row insert fails.
      await this.storage.deleteBackup(key).catch(() => {});
      throw err;
    }
  }

  // ── Admin (HR panel) ────────────────────────────────────────────────────

  async listAdmin(query: {
    jobId?: string;
    status?: string;
    page?: string;
    perPage?: string;
  }) {
    assertCareersFeature(this.featureFlags);
    const page = toPage(query.page);
    const perPage = toPerPage(query.perPage);
    const where: Record<string, unknown> = {};
    if (query.jobId) where.jobPostingId = query.jobId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        include: {
          jobPosting: { select: { id: true, title: true, slug: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.jobApplication.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findAdmin(id: string) {
    assertCareersFeature(this.featureFlags);
    const application = await this.prisma.jobApplication.findUnique({
      where: { id },
      include: {
        jobPosting: {
          select: {
            id: true,
            title: true,
            slug: true,
            location: true,
            employmentType: true,
          },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  async update(id: string, dto: UpdateJobApplicationDto, reviewerId?: string) {
    assertCareersFeature(this.featureFlags);
    const existing = await this.prisma.jobApplication.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Application not found');

    if (dto.status !== undefined && dto.status !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot move an application from ${existing.status} to ${dto.status}`,
        );
      }
    }

    const data: Record<string, unknown> = {
      reviewedById: reviewerId ?? existing.reviewedById,
      reviewedAt: new Date(),
    };
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.internalNote !== undefined) data.internalNote = dto.internalNote;

    return this.prisma.jobApplication.update({
      where: { id },
      data,
      include: {
        jobPosting: { select: { id: true, title: true, slug: true } },
      },
    });
  }

  /**
   * Per-application CV delete (owner requirement). Deletes the file from
   * private storage, clears the cvUrl reference and stamps who/when —
   * the application record itself stays and remains viewable.
   */
  async deleteCv(id: string, deletedById?: string) {
    assertCareersFeature(this.featureFlags);
    const existing = await this.prisma.jobApplication.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Application not found');
    if (!existing.cvUrl) {
      throw new BadRequestException('This application has no CV to delete');
    }

    const key = existing.cvUrl;
    await this.storage.deleteBackup(key).catch(() => {
      // The file is already gone (or the provider hiccuped) — the
      // reference must still be cleared so staff are never stuck.
    });

    return this.prisma.jobApplication.update({
      where: { id },
      data: {
        cvUrl: null,
        cvDeletedAt: new Date(),
        cvDeletedById: deletedById ?? null,
      },
      include: {
        jobPosting: { select: { id: true, title: true, slug: true } },
      },
    });
  }

  /**
   * Admin-only CV download. The stored key is private (never a public
   * URL); the file is streamed back with an attachment disposition and a
   * safe content type — never inline-rendered as HTML.
   */
  async downloadCv(id: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    assertCareersFeature(this.featureFlags);
    const application = await this.prisma.jobApplication.findUnique({
      where: { id },
      select: { cvUrl: true, cvOriginalName: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (!application.cvUrl) {
      throw new NotFoundException('CV not available for this application');
    }
    if (!application.cvUrl.startsWith('private-local/')) {
      // Anything outside the private namespace is never served.
      throw new ForbiddenException('CV storage location is not permitted');
    }

    let stream: Readable;
    try {
      stream = await this.storage.readBackupStream(application.cvUrl);
    } catch {
      throw new NotFoundException('CV file not found in storage');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      filename: cvDownloadFilename(
        application.cvOriginalName,
        application.cvUrl,
      ),
      mimeType: cvMimeTypeForKey(application.cvUrl),
    };
  }
}
