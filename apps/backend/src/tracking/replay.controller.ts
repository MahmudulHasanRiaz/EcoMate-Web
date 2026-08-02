import { Controller, Get, Post, Param } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { ReplayService } from './replay.service';
import { ReplayDeadOutboxDto } from './dto/replay.dto';

/**
 * Admin recovery endpoints (design §4.10): list DEAD outbox rows and trigger a
 * version-pinned replay (`DEAD -> PENDING`) for a snapshot. Both are admin-only
 * and feature-gated on the `admin_tracking` plan feature.
 */
@Controller('tracking/admin')
@RequiresFeature('admin_tracking')
export class ReplayController {
  constructor(private readonly replayService: ReplayService) {}

  @Roles('admin')
  @Get('dead')
  listDead(): Promise<ReplayDeadOutboxDto[]> {
    return this.replayService.listDead();
  }

  @Roles('admin')
  @Post('replay/:snapshotId')
  async replay(@Param('snapshotId') snapshotId: string): Promise<{ ok: true }> {
    await this.replayService.replay(snapshotId);
    return { ok: true };
  }
}
