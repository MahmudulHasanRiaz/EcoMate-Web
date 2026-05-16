import { Controller, Get, Put, Param, Query, Body } from '@nestjs/common';
import { ShipmentService } from './shipment.service';

interface CreateOrUpdateShipmentDto {
  trackingNo?: string;
  courier?: string;
  status?: string;
}

@Controller('shipments')
export class ShipmentController {
  constructor(private readonly svc: ShipmentService) {}

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

  @Get('order/:orderId')
  findByOrderId(@Param('orderId') orderId: string) {
    return this.svc.findByOrderId(orderId);
  }

  @Put('order/:orderId')
  createOrUpdate(
    @Param('orderId') orderId: string,
    @Body() dto: CreateOrUpdateShipmentDto,
  ) {
    return this.svc.createOrUpdate(orderId, dto);
  }
}
