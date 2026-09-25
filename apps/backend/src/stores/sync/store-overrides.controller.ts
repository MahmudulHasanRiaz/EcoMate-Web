/**
 * Override workflow — central-commerce §8.3 + §10 (P4, BR-04).
 *
 * Force EcoMate Value (`reset`) and Keep External Value (`keep`) are the
 * ONLY paths that may change a drifted external value. Both record actor,
 * previous external state and previous baseline (audited operator action).
 */
import { Body, Controller, ForbiddenException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductSyncService } from './product-sync.service';
import { productSyncEnabled, storesEnabled } from '../store-flags';

export class OverrideFieldsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  fields!: string[];
}

@Roles('superadmin', 'admin', 'manager')
@Controller('stores/:id/products/:productId/overrides')
@RequiresFeature('admin_sync_center')
export class StoreOverridesController {
  constructor(private readonly sync: ProductSyncService) {}

  private gate(): void {
    if (!storesEnabled() || !productSyncEnabled()) {
      throw new ForbiddenException('Product sync is disabled');
    }
  }

  @Post('reset')
  @Roles('superadmin', 'admin')
  forceEcoMate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: OverrideFieldsDto,
    @CurrentUser() user?: any,
  ) {
    this.gate();
    return this.sync.forceEcoMateValue(id, productId, dto.fields, user?.sub);
  }

  @Post('keep')
  @Roles('superadmin', 'admin')
  keepExternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: OverrideFieldsDto,
    @CurrentUser() user?: any,
  ) {
    this.gate();
    return this.sync.keepExternalValue(id, productId, dto.fields, user?.sub);
  }

  @Post('reset-all')
  @Roles('superadmin', 'admin')
  resetAll(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user?: any,
  ) {
    this.gate();
    return this.sync.resetAll(id, productId, user?.sub);
  }
}
