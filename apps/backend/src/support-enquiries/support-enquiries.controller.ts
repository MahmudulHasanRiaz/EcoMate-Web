import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SupportEnquiriesService } from './support-enquiries.service';
import { CreateSupportEnquiryDto } from './dto/create-support-enquiry.dto';
import { UpdateSupportEnquiryDto } from './dto/update-support-enquiry.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';

/**
 * Support enquiries (D9). No licence feature key exists for this inbox,
 * so the admin side is guarded by role only — inventing a
 * `@RequiresFeature` key would 403 every tenant until KeyMate adds it.
 */
@Controller('support-enquiries')
export class SupportEnquiriesController {
  constructor(private readonly svc: SupportEnquiriesService) {}

  @RateLimitPolicy('checkout')
  @Public()
  @Post()
  create(@Body() dto: CreateSupportEnquiryDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.findAll({
      status,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupportEnquiryDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.updateStatus(id, dto.status, user?.userId);
  }
}
