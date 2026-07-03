import {
  Controller,
  Get,
  Post,
  Param,
  NotFoundException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('customers')
@RequiresFeature('admin_customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.findAll({
      search,
      page: page ? parseInt(page) || 1 : 1,
      perPage: perPage ? parseInt(perPage) || 20 : 20,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('order-summary')
  async getOrderSummary(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone number required');
    const summary = await this.svc.getOrderSummary(phone);
    if (!summary) return { customer: null, summary: null, recentOrders: [] };
    return summary;
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.svc.findOne(id);
    if (!result) throw new NotFoundException('Customer not found');
    return result;
  }

  @Roles('superadmin', 'admin')
  @Post(':id/block')
  async blockPhone(@Param('id') id: string) {
    await this.svc.blockPhone(id);
    return { success: true };
  }

  @Roles('superadmin', 'admin')
  @Post(':id/unblock')
  async unblockPhone(@Param('id') id: string) {
    await this.svc.unblockPhone(id);
    return { success: true };
  }
}
