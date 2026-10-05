import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CommissionsService } from './commissions.service';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import { SetCommissionRuleActiveDto } from './dto/update-commission-rule.dto';
import { ReverseEarningDto } from './dto/reverse-earning.dto';
import { CommissionEngineService } from './commission-engine.service';
import { CommissionRulesService } from './commission-rules.service';
import { CommissionReportsService } from './commission-reports.service';
import {
  CreateCommissionRuleV2Dto,
  UpdateCommissionRuleV2Dto,
  SetRuleActiveDto,
  PreviewRuleDto,
  CommissionRangeQueryDto,
  CommissionDrilldownQueryDto,
} from './dto/commission-rule-v2.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'employee')
@PermissionsAny('manage_commissions')
@RequiresFeature('admin_hr')
export class CommissionsController {
  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly engine: CommissionEngineService,
    private readonly rules: CommissionRulesService,
    private readonly reports: CommissionReportsService,
  ) {}

  // ── Commission Engine v2 ────────────────────────────────────────────────────
  // Action-scoped rules: an employee earns for a specific operational action
  // (Confirmed / Packed / Shipping / Delivered / Returned / Cancelled), and only
  // the FIRST person to move an order into that action is credited.

  /** Statuses an admin may build a rule against. */
  @Get('commissions/v2/purposes')
  listPurposes() {
    return this.rules.listCommissionablePurposes();
  }

  @Get('commissions/v2/rules')
  listRulesV2(@Query() query: { employeeId?: string; isActive?: string }) {
    return this.rules.list({
      employeeId: query.employeeId,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @Get('commissions/v2/rules/:id')
  getRuleV2(@Param('id') id: string) {
    return this.rules.get(id);
  }

  /** Explain a rule in plain language before it is saved. */
  @Post('commissions/v2/rules/preview')
  previewRule(@Body() dto: PreviewRuleDto) {
    return this.rules.preview(dto);
  }

  @Post('commissions/v2/rules')
  createRuleV2(@Body() dto: CreateCommissionRuleV2Dto, @CurrentUser() user: any) {
    return this.rules.create({ ...dto, createdById: user?.userId ?? null });
  }

  @Patch('commissions/v2/rules/:id')
  updateRuleV2(@Param('id') id: string, @Body() dto: UpdateCommissionRuleV2Dto) {
    return this.rules.update(id, dto);
  }

  /**
   * Deactivate/reactivate a rule. There is no delete: historical ledger rows
   * reference the rule and carry their own calculation snapshot, so past
   * earnings must remain auditable.
   */
  @Post('commissions/v2/rules/:id/active')
  setRuleActiveV2(@Param('id') id: string, @Body() dto: SetRuleActiveDto) {
    return this.rules.setActive(id, dto.isActive);
  }

  /**
   * End a rule today (Dhaka). Closes the validity window while keeping the rule
   * visible and auditable, and still paying for today's qualifying orders —
   * distinct from deactivating, which leaves the window open.
   */
  @Post('commissions/v2/rules/:id/end')
  endRuleV2(@Param('id') id: string) {
    return this.rules.endNow(id);
  }

  /** Employee-wise totals with a purpose breakdown and paid/unpaid split. */
  @Get('commissions/v2/report')
  report(@Query() query: CommissionRangeQueryDto) {
    return this.reports.summary(query);
  }

  @Get('commissions/v2/report/by-rule')
  reportByRule(@Query() query: CommissionRangeQueryDto) {
    return this.reports.byRule(query);
  }

  @Get('commissions/v2/report/trend')
  trend(@Query() query: CommissionRangeQueryDto & { days?: string }) {
    return this.reports.trend({ ...query, days: query.days ? Number(query.days) : undefined });
  }

  /** Order-level drilldown for one employee and purpose. */
  @Get('commissions/v2/report/drilldown')
  drilldown(@Query() query: CommissionDrilldownQueryDto) {
    // employeeId is required for a drilldown; reject rather than silently
    // reporting an organisation-wide list under a per-employee URL.
    if (!query.employeeId) {
      throw new BadRequestException('employeeId is required');
    }
    return this.reports.drilldown({ ...query, employeeId: query.employeeId });
  }

  /** Full audit trail for a single earning: why was this paid? */
  @Get('commissions/v2/earnings/:id')
  earningDetail(@Param('id') id: string) {
    return this.reports.earningDetail(id);
  }

  @Post('commissions/rules')
  createRule(
    @Body() dto: CreateCommissionRuleDto,
    @CurrentUser() user?: any,
  ) {
    return this.commissionsService.createRule(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('commissions/rules')
  listRules(
    @Query('employeeId') employeeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.commissionsService.listRules({
      employeeId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Patch('commissions/rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.commissionsService.updateRule(id, dto);
  }

  @Post('commissions/rules/:id/active')
  setActive(
    @Param('id') id: string,
    @Body() dto: SetCommissionRuleActiveDto,
  ) {
    return this.commissionsService.setActive(id, dto.isActive);
  }

  @Delete('commissions/rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.commissionsService.deleteRule(id);
  }

  @Get('commissions/earnings')
  listEarnings(
    @Query('employeeId') employeeId?: string,
    @Query('reversed') reversed?: string,
    @Query('inPayroll') inPayroll?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.commissionsService.listEarnings(
      { employeeId, reversed, inPayroll },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('commissions/earnings/:id/reverse')
  reverseEarning(
    @Param('id') id: string,
    @Body() dto: ReverseEarningDto,
    @CurrentUser() user?: any,
  ) {
    return this.commissionsService.reverseEarning(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }
}
