import {
  Controller,
  Get,
  Post,
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
import { MarketingFundingService } from './marketing-funding.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import {
  CreateFundingDto,
  PostFundingDto,
  ConsumeFundingDto,
} from './dto/marketing.dto';

@Roles('superadmin', 'admin')
@Controller('marketing/funding')
@RequiresFeature('marketing_attribution')
export class MarketingFundingController {
  constructor(
    private readonly funding: MarketingFundingService,
    private readonly consumption: MarketingConsumptionService,
  ) {}

  @Post()
  addFunding(
    @Body() dto: CreateFundingDto,
    @CurrentUser() user?: any,
  ) {
    return this.funding.addFunding(dto, user?.sub);
  }

  @Get()
  listFunding(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('adAccountId') adAccountId?: string,
  ) {
    const p = this.parsePage(page, perPage);
    return this.funding.list(p.page, p.perPage, adAccountId);
  }

  @Get('summary')
  fundingSummary() {
    return this.funding.summary();
  }

  @Post(':id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: any) {
    return this.funding.confirm(id, user?.sub);
  }

  @Post(':id/post')
  post(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostFundingDto, @CurrentUser() user?: any) {
    return this.funding.post(id, dto, user?.sub);
  }

  @Post(':id/archive')
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: any) {
    return this.funding.archive(id, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: any) {
    return this.funding.remove(id, user?.sub);
  }

  @Post('consume')
  consume(@Body() dto: ConsumeFundingDto) {
    return this.consumption.consume(dto.campaignId, dto.amount, dto.source ?? 'allocation');
  }

  private parsePage(page?: string, perPage?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const pp = perPage ? parseInt(perPage, 10) : 20;
    if (isNaN(p) || p < 1) throw new BadRequestException('Invalid page');
    if (isNaN(pp) || pp < 1) throw new BadRequestException('Invalid perPage');
    return { page: p, perPage: pp };
  }
}