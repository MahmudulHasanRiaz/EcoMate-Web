import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { OrderImportService } from './order-import.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('import')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly orderImportService: OrderImportService,
  ) {}

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

    const result = await this.importService.importFromCsv(csvContent, {
      mode: mode === 'update' ? 'update' : 'create',
      dryRun: dryRun === 'true',
    });

    return result;
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

    const result = await this.orderImportService.importFromCsv(csvContent);
    return result;
  }
}
