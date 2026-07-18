import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CourierCustomerHistoryService } from './courier-customer-history.service';

@Roles('superadmin', 'admin', 'manager')
@Controller('couriers/customer-history')
@RequiresFeature('admin_courier')
export class CourierCustomerHistoryController {
  constructor(private readonly svc: CourierCustomerHistoryService) {}

  @Get()
  async getHistory(@Query('phone') phone: string, @Query('courier') courier?: string) {
    if (!phone) throw new BadRequestException('Phone number required');
    if (courier) {
      return this.svc.getCustomerHistory(courier, phone);
    }
    return this.svc.getAll(phone);
  }
}
