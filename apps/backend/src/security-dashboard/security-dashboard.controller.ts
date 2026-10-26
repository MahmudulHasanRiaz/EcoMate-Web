import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Body,
  ParseIntPipe,
  DefaultValuePipe,
  NotFoundException,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SecurityEventSeverity, SecurityEventCategory, SecurityActorType } from '@prisma/client';
import { DashboardQueryService } from './services/dashboard-query.service';
import type {
  DashboardSummary,
  EventTimelineResponse,
  TrendResponse,
  TopOffendersResponse,
  BlockActivityResponse,
  RetentionConfigResponse,
  EventDetailResponse,
  CorrelationNode,
} from './interfaces/dashboard-data.interface';

@Controller('admin/security/dashboard')
@Permissions('view_security_dashboard')
export class SecurityDashboardController {
  constructor(private readonly query: DashboardQueryService) {}

  @Get('summary')
  async getSummary(): Promise<DashboardSummary> {
    return this.query.getSummary();
  }

  @Get('timeline')
  async getTimeline(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('severity') severity?: SecurityEventSeverity,
    @Query('category') category?: SecurityEventCategory,
    @Query('eventType') eventType?: string,
  ): Promise<EventTimelineResponse> {
    return this.query.getTimeline(limit, cursor, { severity, category, eventType });
  }

  @Get('trends')
  async getTrends(
    @Query('interval', new DefaultValuePipe('hourly')) interval: 'hourly' | 'daily',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('severity') severity?: SecurityEventSeverity,
    @Query('eventType') eventType?: string,
    @Query('category') category?: SecurityEventCategory,
  ): Promise<TrendResponse> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 86400000);
    return this.query.getTrends(interval, fromDate, toDate, {
      severity,
      eventType,
      category,
    });
  }

  @Get('top-offenders')
  async getTopOffenders(
    @Query('window', new DefaultValuePipe('24h')) window: '1h' | '24h' | '7d',
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('actorType') actorType?: SecurityActorType,
  ): Promise<TopOffendersResponse> {
    return this.query.getTopOffenders(window, limit, actorType);
  }

  @Get('block-activity')
  async getBlockActivity(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BlockActivityResponse> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 86400000);
    return this.query.getBlockActivity(fromDate, toDate);
  }

  @Get('events/:id')
  async getEventDetail(@Param('id') id: string): Promise<EventDetailResponse> {
    const event = await this.query.getEventDetail(id);
    if (!event) throw new NotFoundException(`Security event ${id} not found`);
    return event;
  }

  @Get('events/:id/chain')
  async getCorrelationChain(
    @Param('id') id: string,
  ): Promise<CorrelationNode[]> {
    const event = await this.query.getEventDetail(id);
    if (!event) throw new NotFoundException(`Security event ${id} not found`);
    const correlationId = event.correlationId || event.id;
    return this.query.getCorrelationChain(correlationId);
  }

  // EXCEPTION (2026-10-26, documented): retention stays @Roles('superadmin'),
  // NOT a permission key. A permission key cannot express superadmin-only
  // here: preset-less admins receive ALL catalogue keys via
  // getAllPermissions(), so @Permissions('manage_security_retention') would
  // silently grant retention to every preset-less admin. Widen only with an
  // explicit owner decision.
  @Get('retention')
  @Roles('superadmin')
  async getRetentionConfig(): Promise<RetentionConfigResponse> {
    return this.query.getRetentionConfig();
  }

  @Put('retention')
  @Roles('superadmin')
  async updateRetentionPolicy(
    @Body()
    data: {
      category: SecurityEventCategory;
      severity: SecurityEventSeverity;
      retentionDays: number;
      criticalRetentionDays?: number | null;
    },
  ) {
    return this.query.updateRetentionPolicy(
      data.category,
      data.severity,
      {
        retentionDays: data.retentionDays,
        criticalRetentionDays: data.criticalRetentionDays,
      },
    );
  }
}
