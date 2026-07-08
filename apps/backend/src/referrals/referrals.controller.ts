import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';
import { ClaimReferralDto } from './dto/claim-referral.dto';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_referrals')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.referralsService.findAll(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }

  @Get('my')
  async getMyReferral(@CurrentUser() user: { userId: string }) {
    return this.referralsService.getOrCreateReferral(user.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_referrals')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.referralsService.findOne(id);
  }

  @Public()
  @Post('claim')
  async claimReferral(@Body() dto: ClaimReferralDto) {
    return this.referralsService.claimReferral(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_referrals')
  @Get(':id/leads')
  async findLeads(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.referralsService.findLeads(
      id,
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }
}
