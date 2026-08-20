import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MarketingSyncService } from './marketing-sync.service';
import { MarketingAttributionService } from './marketing-attribution.service';
import {
  CreateConnectionDto,
  UpdateConnectionDto,
  AddAdAccountDto,
  DiscoverAdAccountsDto,
  UpdateAdAccountDto,
  AttributionRebuildDto,
  UpdateCampaignDto,
} from './dto/marketing.dto';

@Roles('superadmin', 'admin', 'manager')
@Controller('marketing')
@RequiresFeature('marketing_attribution')
export class MarketingController {
  constructor(
    private readonly platforms: MarketingPlatformsService,
    private readonly connections: MarketingConnectionsService,
    private readonly sync: MarketingSyncService,
    private readonly attribution: MarketingAttributionService,
  ) {}

  @Get('platforms')
  listPlatforms() {
    return this.platforms.list();
  }

  @Get('connections')
  listConnections() {
    return this.connections.list();
  }

  @Post('connections')
  createConnection(
    @Body() dto: CreateConnectionDto,
    @CurrentUser() user?: any,
  ) {
    return this.connections.create(dto, user?.sub);
  }

  @Get('connections/:id')
  getConnection(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.findOne(id);
  }

  @Put('connections/:id')
  updateConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
    @CurrentUser() user?: any,
  ) {
    return this.connections.update(id, dto, user?.sub);
  }

  @Post('connections/:id/disconnect')
  disconnectConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.connections.disconnect(id, user?.sub);
  }

  @Post('connections/:id/refresh')
  refreshConnection(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.refreshLongLivedToken(id);
  }

  @Delete('connections/:id')
  removeConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.connections.remove(id, user?.sub);
  }

  @Get('ad-accounts')
  listAdAccounts(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('connectionId') connectionId?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.connections.listAdAccountsPaginated(p.page, p.perPage, connectionId);
  }

  @Post('ad-accounts')
  addAdAccount(
    @Body() dto: AddAdAccountDto,
    @CurrentUser() user?: any,
  ) {
    return this.connections.addAdAccount(dto, user?.sub);
  }

  @Post('ad-accounts/discover')
  discoverAdAccounts(
    @Body() dto: DiscoverAdAccountsDto,
    @CurrentUser() user?: any,
  ) {
    return this.connections.discoverAdAccounts(dto, user?.sub);
  }

  @Get('ad-accounts/:id')
  getAdAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.getAdAccount(id);
  }

  @Put('ad-accounts/:id')
  updateAdAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdAccountDto,
  ) {
    return this.connections.updateAdAccount(id, dto);
  }

  @Post('ad-accounts/:id/sync')
  syncAdAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.syncAdAccount(id);
  }

  @Post('ad-accounts/:id/refresh')
  refreshAdAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.syncAdAccount(id, true);
  }

  @Delete('ad-accounts/:id')
  removeAdAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.connections.removeAdAccount(id, user?.sub);
  }

  @Get('campaigns')
  listCampaigns(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('adAccountId') adAccountId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.connections.listCampaigns(p.page, p.perPage, adAccountId, status, search);
  }

  @Get('campaigns/:id')
  getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.getCampaign(id);
  }

  @Put('campaigns/:id')
  updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.connections.updateCampaign(id, dto);
  }

  @Post('campaigns/:id/pause')
  pauseCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.connections.pauseCampaign(id, user?.sub);
  }

  @Post('campaigns/:id/resume')
  resumeCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
  ) {
    return this.connections.resumeCampaign(id, user?.sub);
  }

  @Get('insights')
  listInsights(
    @Query('campaignId') campaignId?: string,
    @Query('adAccountId') adAccountId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.connections.listInsights(
      campaignId,
      adAccountId,
      fromDate,
      toDate,
      p.page,
      p.perPage,
    );
  }

  @Get('sessions')
  listSessions(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('utmCampaign') utmCampaign?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.attribution.listSessions(p.page, p.perPage, utmCampaign);
  }

  @Get('attributions')
  listAttributions(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.attribution.listAttributions(p.page, p.perPage, campaignId);
  }

  @Post('attribution/rebuild')
  rebuildAttribution(
    @Body() dto: AttributionRebuildDto,
    @CurrentUser() user?: any,
  ) {
    return this.attribution.rebuildMissing(dto.fromDate, dto.toDate);
  }

  @Get('audit')
  listAudit(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.connections.listAudit(p.page, p.perPage);
  }

  private parsePage(page?: string, perPage?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const pp = perPage ? parseInt(perPage, 10) : 20;
    if (isNaN(p) || p < 1) throw new BadRequestException('Invalid page');
    if (isNaN(pp) || pp < 1) throw new BadRequestException('Invalid perPage');
    return { page: p, perPage: pp };
  }
}