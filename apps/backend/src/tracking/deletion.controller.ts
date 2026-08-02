import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { DeletionService, DeletionResult } from './tracking-deletion.service';
import { DeletionDto } from './dto/deletion.dto';

/**
 * Admin GDPR-style deletion endpoint (design §14): `POST /tracking/admin/delete`
 * with either `externalId` or `customerId` in the body erases the shopper's
 * tracking footprint (contexts deleted, snapshot customer PII nulled) and
 * returns the counts. Admin-only + feature-gated on `admin_tracking`.
 */
@Controller('tracking/admin')
@RequiresFeature('admin_tracking')
export class DeletionController {
  constructor(private readonly deletionService: DeletionService) {}

  @Roles('admin')
  @Post('delete')
  async delete(@Body() body: DeletionDto): Promise<DeletionResult> {
    // The DTO requires one of the two, but guard here too so a malformed
    // request can never hit the service without a selector.
    if (body.externalId) {
      return this.deletionService.deleteByExternalId(body.externalId);
    }
    if (body.customerId) {
      return this.deletionService.deleteByCustomerId(body.customerId);
    }
    throw new BadRequestException(
      'Provide either externalId or customerId to delete',
    );
  }
}
