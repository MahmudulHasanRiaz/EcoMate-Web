import { Controller, Get, BadRequestException, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get('order-summary')
  async getOrderSummary(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone number required');
    const summary = await this.svc.getOrderSummary(phone);
    if (!summary) return { customer: null, summary: null, recentOrders: [] };
    return summary;
  }
}
