import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('warehouses')
@UseGuards(JwtAuthGuard)
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  findAll(@Query('type') type?: string) {
    return this.svc.findAll(type);
  }
}
