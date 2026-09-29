import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { PosAnalyticsService } from './pos-analytics.service';
import { PosAnalyticsQueryDto } from './dto/pos-analytics-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('pos/analytics')
export class PosAnalyticsController {
  constructor(private readonly svc: PosAnalyticsService) {}

  private requestOf(
    sessionId: string | undefined,
    user: any,
    query: PosAnalyticsQueryDto,
    forgedShowroomId?: string,
  ) {
    if (forgedShowroomId !== undefined) {
      throw new BadRequestException(
        'showroomId is not accepted: the showroom is resolved server-side from x-pos-session-id',
      );
    }
    return {
      sessionId,
      userId: user?.userId ?? user?.id,
      query,
    };
  }

  @Get('overview')
  @Roles('cashier', 'admin')
  overview(
    @Headers('x-pos-session-id') sessionId: string | undefined,
    @CurrentUser() user: { userId: string },
    @Query() query: PosAnalyticsQueryDto,
    @Query('showroomId') forgedShowroomId?: string,
  ) {
    return this.svc.getOverview(
      this.requestOf(sessionId, user, query, forgedShowroomId),
    );
  }

  @Get('transactions')
  @Roles('cashier', 'admin')
  transactions(
    @Headers('x-pos-session-id') sessionId: string | undefined,
    @CurrentUser() user: { userId: string },
    @Query() query: PosAnalyticsQueryDto,
    @Query('showroomId') forgedShowroomId?: string,
  ) {
    return this.svc.getTransactions(
      this.requestOf(sessionId, user, query, forgedShowroomId),
    );
  }

  @Get('export.xlsx')
  @Roles('cashier', 'admin')
  async export(
    @Headers('x-pos-session-id') sessionId: string | undefined,
    @CurrentUser() user: { userId: string },
    @Query() query: PosAnalyticsQueryDto,
    @Query('showroomId') forgedShowroomId: string | undefined,
  ) {
    const { buffer, filename } = await this.svc.buildExport(
      this.requestOf(sessionId, user, query, forgedShowroomId),
    );
    // StreamableFile: adapter-agnostic (app runs Fastify — no Express res).
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
