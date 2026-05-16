import { Controller, Get, Query } from '@nestjs/common';
import { CourierService } from './courier.service';

@Controller('courier')
export class CourierController {
  constructor(private readonly svc: CourierService) {}

  @Get('search')
  search(@Query('phone') phone: string) {
    return this.svc.search(phone);
  }

  @Get('summary')
  summary(@Query('phone') phone: string) {
    return this.svc.summary(phone);
  }
}
