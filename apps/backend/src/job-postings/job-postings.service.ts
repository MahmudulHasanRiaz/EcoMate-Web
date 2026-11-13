import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { PrismaService } from '../prisma/prisma.service';
import { assertCareersFeature } from './careers-feature';
import { CreateJobPostingDto } from './dto/create-job-posting.dto';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto';

const MAX_PER_PAGE = 100;

const POSTING_INCLUDE = {
  department: { select: { id: true, name: true, slug: true } },
  designation: { select: { id: true, name: true, slug: true } },
} as const;

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'job';
}

function toPage(value?: string): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toPerPage(value?: string): number {
  const n = parseInt(value ?? '20', 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, MAX_PER_PAGE);
}

/**
 * Public visibility rule: PUBLISHED and (no deadline OR deadline in the
 * future). A posting whose deadline has passed stops being listed or
 * openable — its admin record stays for the HR panel.
 */
function publicWhere(now: Date): Record<string, unknown> {
  return {
    status: 'PUBLISHED',
    OR: [{ deadline: null }, { deadline: { gt: now } }],
  };
}

@Injectable()
export class JobPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ── Public ──────────────────────────────────────────────────────────────
  // NOTE: public reads are intentionally NOT feature-gated. Option B keeps
  // /careers live for every tenant; only the apply affordance (and all of
  // the HR-panel side) is gated. Gating the list would blank the page on a
  // licence-fetch failure, which yields features: [].

  async listPublic(query: {
    department?: string;
    type?: string;
    location?: string;
    page?: string;
    perPage?: string;
  }) {
    const page = toPage(query.page);
    const perPage = toPerPage(query.perPage);
    const where: Record<string, unknown> = publicWhere(new Date());

    if (query.type) where.employmentType = query.type;
    if (query.location) {
      where.location = { contains: query.location, mode: 'insensitive' };
    }
    if (query.department) {
      const dept = await this.prisma.department.findFirst({
        where: {
          OR: [{ id: query.department }, { slug: query.department }],
        },
        select: { id: true },
      });
      if (!dept) {
        return {
          data: [],
          meta: { total: 0, page, perPage, totalPages: 0 },
        };
      }
      where.departmentId = dept.id;
    }

    const [data, total] = await Promise.all([
      this.prisma.jobPosting.findMany({
        where,
        include: POSTING_INCLUDE,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.jobPosting.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findPublicBySlug(slug: string) {
    const posting = await this.prisma.jobPosting.findUnique({
      where: { slug },
      include: POSTING_INCLUDE,
    });
    if (!posting) throw new NotFoundException('Job posting not found');
    if (posting.status !== 'PUBLISHED') {
      throw new NotFoundException('Job posting not found');
    }
    if (posting.deadline && posting.deadline <= new Date()) {
      throw new NotFoundException('Job posting not found');
    }
    return posting;
  }

  // ── Admin (HR panel) ────────────────────────────────────────────────────

  async listAdmin(query: { status?: string; page?: string; perPage?: string }) {
    assertCareersFeature(this.featureFlags);
    const page = toPage(query.page);
    const perPage = toPerPage(query.perPage);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.jobPosting.findMany({
        where,
        include: {
          ...POSTING_INCLUDE,
          _count: { select: { applications: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.jobPosting.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findAdmin(id: string) {
    assertCareersFeature(this.featureFlags);
    const posting = await this.prisma.jobPosting.findUnique({
      where: { id },
      include: {
        ...POSTING_INCLUDE,
        _count: { select: { applications: true } },
      },
    });
    if (!posting) throw new NotFoundException('Job posting not found');
    return posting;
  }

  async create(dto: CreateJobPostingDto, createdById?: string) {
    assertCareersFeature(this.featureFlags);
    await this.assertDepartmentAndDesignation(dto.departmentId, dto.designationId);
    if (
      dto.salaryMin !== undefined &&
      dto.salaryMax !== undefined &&
      dto.salaryMax < dto.salaryMin
    ) {
      throw new BadRequestException('salaryMax must not be less than salaryMin');
    }

    const slug = await this.uniqueSlug(slugify(dto.title));
    return this.prisma.jobPosting.create({
      data: {
        slug,
        title: dto.title,
        departmentId: dto.departmentId ?? null,
        designationId: dto.designationId ?? null,
        location: dto.location,
        employmentType: dto.employmentType ?? 'Full-time',
        salaryMin: dto.salaryMin ?? null,
        salaryMax: dto.salaryMax ?? null,
        salaryDisplay: dto.salaryDisplay ?? null,
        description: dto.description,
        requirements: dto.requirements ?? null,
        responsibilities: dto.responsibilities ?? null,
        benefits: (dto.benefits ?? null) as unknown as Prisma.InputJsonValue,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        status: dto.status ?? 'DRAFT',
        sortOrder: dto.sortOrder ?? 0,
        createdById: createdById ?? null,
      },
      include: POSTING_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateJobPostingDto) {
    assertCareersFeature(this.featureFlags);
    const existing = await this.prisma.jobPosting.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Job posting not found');
    await this.assertDepartmentAndDesignation(
      dto.departmentId ?? undefined,
      dto.designationId ?? undefined,
    );
    const salaryMin = dto.salaryMin ?? existing.salaryMin;
    const salaryMax = dto.salaryMax ?? existing.salaryMax;
    if (
      salaryMin !== null &&
      salaryMax !== null &&
      salaryMin !== undefined &&
      salaryMax !== undefined &&
      salaryMax < salaryMin
    ) {
      throw new BadRequestException('salaryMax must not be less than salaryMin');
    }

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.designationId !== undefined) data.designationId = dto.designationId;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.employmentType !== undefined) data.employmentType = dto.employmentType;
    if (dto.salaryMin !== undefined) data.salaryMin = dto.salaryMin;
    if (dto.salaryMax !== undefined) data.salaryMax = dto.salaryMax;
    if (dto.salaryDisplay !== undefined) data.salaryDisplay = dto.salaryDisplay;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.requirements !== undefined) data.requirements = dto.requirements;
    if (dto.responsibilities !== undefined) data.responsibilities = dto.responsibilities;
    if (dto.benefits !== undefined) {
      data.benefits = dto.benefits as unknown as Prisma.InputJsonValue;
    }
    if (dto.deadline !== undefined) {
      data.deadline = dto.deadline ? new Date(dto.deadline) : null;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.jobPosting.update({
      where: { id },
      data,
      include: POSTING_INCLUDE,
    });
  }

  private async assertDepartmentAndDesignation(
    departmentId?: string | null,
    designationId?: string | null,
  ): Promise<void> {
    if (departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (designationId) {
      const des = await this.prisma.designation.findUnique({
        where: { id: designationId },
        select: { id: true },
      });
      if (!des) throw new NotFoundException('Designation not found');
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let n = 2;
    while (
      await this.prisma.jobPosting.findUnique({
        where: { slug: candidate },
        select: { id: true },
      })
    ) {
      candidate = `${base}-${n++}`;
    }
    return candidate;
  }
}
