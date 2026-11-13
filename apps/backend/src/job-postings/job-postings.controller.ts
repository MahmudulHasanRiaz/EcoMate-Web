import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { JobPostingsService } from './job-postings.service';
import { JobApplicationsService } from '../job-applications/job-applications.service';
import { CreateJobPostingDto } from './dto/create-job-posting.dto';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto';
import { ApplyJobDto } from '../job-applications/dto/apply-job.dto';

@Controller('jobs')
export class JobPostingsController {
  constructor(
    private readonly postings: JobPostingsService,
    private readonly applications: JobApplicationsService,
  ) {}

  // ── Public ──────────────────────────────────────────────────────────────

  @Public()
  @Get()
  listPublic(
    @Query('department') department?: string,
    @Query('type') type?: string,
    @Query('location') location?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.postings.listPublic({ department, type, location, page, perPage });
  }

  @Public()
  @Get(':slug')
  findPublic(@Param('slug') slug: string) {
    return this.postings.findPublicBySlug(slug);
  }

  /**
   * POST /jobs/:slug/apply — public, multipart (fields + `cv` file part).
   * The app runs Fastify, so the file is read via @fastify/multipart parts
   * (the upload.controller.ts pattern) — NOT the Express FileInterceptor.
   * The feature gate is enforced server-side in the service: a direct POST
   * must not bypass the storefront's cosmetic flag check.
   */
  @Public()
  @RateLimitPolicy('checkout')
  @Post(':slug/apply')
  async apply(
    @Param('slug') slug: string,
    @Req() req: FastifyRequest,
  ) {
    const fields: Record<string, string> = {};
    let cv: { buffer: Buffer; originalname: string } | null = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        // First `cv` file part wins; extra file parts are ignored.
        if (part.fieldname === 'cv' && !cv) {
          const buffer = await part.toBuffer();
          cv = { buffer, originalname: part.filename };
        }
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    const dto = plainToInstance(ApplyJobDto, fields);
    const errors = await validate(dto);
    if (errors.length > 0) {
      const messages = errors.flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );
      throw new BadRequestException(messages);
    }

    return this.applications.apply(slug, dto, cv);
  }

  // ── Admin (HR panel) ────────────────────────────────────────────────────
  // Class-level guards live on HrJobPostingsController below (same file,
  // separate @Controller prefix — NestJS registers each decorated class).
}

@Controller('hr/job-postings')
@Roles('superadmin', 'admin', 'employee')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr_careers')
export class HrJobPostingsController {
  constructor(private readonly postings: JobPostingsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.postings.listAdmin({ status, page, perPage });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postings.findAdmin(id);
  }

  @Post()
  create(
    @Body() dto: CreateJobPostingDto,
    @CurrentUser() user: { userId: string } | null,
  ) {
    return this.postings.create(dto, user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobPostingDto) {
    return this.postings.update(id, dto);
  }
}
