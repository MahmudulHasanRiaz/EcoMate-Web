import { Controller, Get, Post, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { MarketingSnapshotService } from './marketing-snapshot.service';

@Roles('superadmin', 'admin', 'manager')
@Controller('marketing/snapshots')
@RequiresFeature('marketing_attribution')
export class MarketingSnapshotController {
  constructor(private readonly snapshots: MarketingSnapshotService) {}

  @Get('products')
  products(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.snapshots.productSnapshotSummary(fromDate, toDate);
  }

  @Post('products/rebuild')
  rebuild(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.snapshots.rebuildProductSnapshots(fromDate, toDate);
  }
}