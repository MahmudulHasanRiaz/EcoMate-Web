/**
 * Product store-availability controller — central-commerce §10 (P3).
 *
 * Double-gated (BR-25): `@RequiresFeature('admin_stores')` AND the
 * fail-closed runtime flags. Reads: manager+. Writes: superadmin|admin.
 * NATIVE store ids are rejected 400 by the service (BR-20); bulk excludes
 * NATIVE with excludedNativeCount.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { DistributionService } from './distribution.service';
import { storesEnabled } from '../store-flags';
import { BulkAvailabilityDto, PutAvailabilityDto, UpsertRuleDto } from './dto/distribution.dto';

@Roles('superadmin', 'admin', 'manager')
@Controller('products')
@RequiresFeature('admin_stores')
export class ProductStoreAvailabilityController {
  constructor(private readonly distribution: DistributionService) {}

  private assertEnabled(): void {
    if (!storesEnabled()) {
      throw new ForbiddenException('Third-party stores are disabled');
    }
  }

  @Get(':id/store-availability')
  getAvailability(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.distribution.getAvailability(id);
  }

  @Put(':id/store-availability')
  @Roles('superadmin', 'admin')
  setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutAvailabilityDto,
  ) {
    this.assertEnabled();
    return this.distribution.setOverride(id, dto.storeId, dto.available);
  }

  @Post(':id/store-availability/bulk')
  @Roles('superadmin', 'admin')
  bulkSet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BulkAvailabilityDto) {
    this.assertEnabled();
    return this.distribution.bulkSet(id, dto.action, dto.confirm);
  }

  @Get(':id/store-availability/bulk/:jobId')
  bulkJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    this.assertEnabled();
    void id;
    return this.distribution.getBulkJob(jobId);
  }
}

/**
 * Store availability rules controller — central-commerce §10 (P3).
 * `GET /store-availability-rules[?storeId=]` ·
 * `PUT /store-availability-rules/:categoryId`.
 */
@Roles('superadmin', 'admin', 'manager')
@Controller('store-availability-rules')
@RequiresFeature('admin_stores')
export class StoreAvailabilityRulesController {
  constructor(private readonly distribution: DistributionService) {}

  private assertEnabled(): void {
    if (!storesEnabled()) {
      throw new ForbiddenException('Third-party stores are disabled');
    }
  }

  @Get()
  listRules(@Query('storeId') storeId?: string) {
    this.assertEnabled();
    return this.distribution.listRules(storeId);
  }

  @Put(':categoryId')
  @Roles('superadmin', 'admin')
  upsertRule(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpsertRuleDto,
  ) {
    this.assertEnabled();
    return this.distribution.upsertRule(dto.storeId, categoryId, {
      available: dto.available,
      inheritFromParent: dto.inheritFromParent,
    });
  }
}
