import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { OrderImportService } from './order-import.service';
import { ImportJobManager } from './import-job-manager';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import * as Papa from 'papaparse';

function estimateCsvRows(content: string): number {
  let count = 0;
  let idx = -1;
  while ((idx = content.indexOf('\n', idx + 1)) !== -1) {
    count++;
  }
  return Math.max(1, count - 1); // Exclude header row
}


@Controller('import')
@RequiresFeature('admin_import')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly orderImportService: OrderImportService,
    private readonly jobManager: ImportJobManager,
  ) {}

  @Get('status/:jobId')
  @Roles('superadmin', 'admin')
  getJobStatus(@Param('jobId') jobId: string) {
    const job = this.jobManager.getJob(jobId);
    if (!job) {
      throw new BadRequestException('Job not found');
    }
    return job;
  }

  @Post('products')
  @Roles('superadmin', 'admin')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowedMime = [
          'text/csv',
          'text/plain',
          'application/csv',
          'application/octet-stream',
        ];
        const allowedExt = file.originalname.toLowerCase().endsWith('.csv');

        if (allowedMime.includes(file.mimetype) || allowedExt) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV files are allowed'), false);
        }
      },
    }),
  )
  async importProducts(
    @UploadedFile() file: Express.Multer.File,
    @Query('mode') mode?: string,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    const csvContent = file.buffer.toString('utf-8');
    if (!csvContent.trim()) {
      throw new BadRequestException('CSV file is empty');
    }

    const totalItems = estimateCsvRows(csvContent);

    const isDryRun = dryRun === 'true';
    const job = this.jobManager.createJob('products', totalItems);

    if (isDryRun) {
      // For dry-runs, process synchronously as it only validates headers and has 0 DB writes or images downloaded
      try {
        const result = await this.importService.importFromCsv(csvContent, {
          mode: mode === 'update' ? 'update' : 'create',
          dryRun: true,
        });
        return { status: 'completed', summary: result.summary, errors: result.errors };
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }

    // Run actual import in background
    this.importService
      .importFromCsv(csvContent, {
        mode: mode === 'update' ? 'update' : 'create',
        dryRun: false,
        onProgress: (processed) => {
          this.jobManager.updateProgress(job.id, processed);
        },
      })
      .then((result) => {
        this.jobManager.completeJob(job.id, result.summary, result.errors);
      })
      .catch((err) => {
        this.jobManager.failJob(job.id, err.message);
      });

    return { jobId: job.id, status: 'processing', message: 'Import started' };
  }

  @Post('orders')
  @Roles('superadmin', 'admin')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowedMime = [
          'text/csv',
          'text/plain',
          'application/csv',
          'application/octet-stream',
        ];
        const allowedExt = file.originalname.toLowerCase().endsWith('.csv');

        if (allowedMime.includes(file.mimetype) || allowedExt) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV files are allowed'), false);
        }
      },
    }),
  )
  async importOrders(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    const csvContent = file.buffer.toString('utf-8');
    if (!csvContent.trim()) {
      throw new BadRequestException('CSV file is empty');
    }

    const totalItems = estimateCsvRows(csvContent);

    const job = this.jobManager.createJob('orders', totalItems);

    // Run in background
    this.orderImportService
      .importFromCsv(csvContent, {
        onProgress: (processed) => {
          this.jobManager.updateProgress(job.id, processed);
        },
      })
      .then((result) => {
        this.jobManager.completeJob(job.id, result.summary, result.errors);
      })
      .catch((err) => {
        this.jobManager.failJob(job.id, err.message);
      });

    return { jobId: job.id, status: 'processing', message: 'Import started' };
  }
}
