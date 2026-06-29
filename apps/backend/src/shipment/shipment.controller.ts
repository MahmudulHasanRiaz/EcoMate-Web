import { Controller, Get, Put, Param, Query, Body } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

interface CreateOrUpdateShipmentDto {
  trackingNo?: string;
  courier?: string;
  status?: string;
}

@Controller('shipments')
@RequiresFeature('admin_shipments')
export class ShipmentController {
  constructor(private readonly svc: ShipmentService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('courier') courier?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      courier,
      status,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('order/:orderId')
  findByOrderId(@Param('orderId') orderId: string) {
    return this.svc.findByOrderId(orderId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put('order/:orderId')
  createOrUpdate(
    @Param('orderId') orderId: string,
    @Body() dto: CreateOrUpdateShipmentDto,
  ) {
    return this.svc.createOrUpdate(orderId, dto);
  }
}
