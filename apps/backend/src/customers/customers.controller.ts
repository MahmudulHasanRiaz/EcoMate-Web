import { Controller, Get, BadRequestException, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('customers')
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
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
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
}
