/**
 * Read-only registry endpoints for the admin UI.
 *
 * These drive the manual-order source dropdowns, which are capability-filtered
 * server-side rather than trusting a hardcoded list in the client.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SourcePlatformsService } from './source-platforms.service';
import {
  CHANNEL_LABELS,
  ACQUISITION_LABELS,
  ACQUISITION_VALUES,
  type SourceCapability,
} from './sales-channel.constants';

@Controller('sales-channel')
@Roles('superadmin', 'admin', 'manager')
export class SalesChannelController {
  constructor(private readonly sourcePlatforms: SourcePlatformsService) {}

  /** Channel + acquisition vocabulary for the UI. */
  @Get('options')
  options() {
    return {
      channels: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })),
      acquisitionTypes: ACQUISITION_VALUES.map((value) => ({
        value,
        label: ACQUISITION_LABELS[value],
      })),
    };
  }

  /** Enabled source platforms, optionally filtered by capability. */
  @Get('sources')
  sources(@Query('capability') capability?: SourceCapability) {
    return capability
      ? this.sourcePlatforms.listByCapability(capability)
      : this.sourcePlatforms.listAll();
  }
}
