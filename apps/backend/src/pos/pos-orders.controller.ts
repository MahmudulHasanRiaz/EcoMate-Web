import { Controller, Post, Get, Delete, Param, Body, Query, Req, Headers, BadRequestException } from '@nestjs/common';
import { PosOrdersService } from './pos-orders.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { HoldCartDto } from './dto/hold-cart.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('pos')
export class PosOrdersController {
  constructor(private readonly svc: PosOrdersService) {}

  @Post('orders')
  @Roles('cashier', 'admin')
  create(@Body() dto: CreatePosOrderDto, @Req() req: any, @Headers('x-pos-session-id') sessionId?: string) {
    if (!sessionId) throw new BadRequestException('POS session required (x-pos-session-id header)');
    return this.svc.create(dto, sessionId, req.user.id);
  }

  @Get('customers')
  @Roles('cashier', 'admin')
  async findCustomer(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone required');
    return this.svc.findCustomerByPhone(phone);
  }

  @Post('customers/quick')
  @Roles('cashier', 'admin')
  async quickCreateCustomer(@Body() dto: { phoneNumber: string; firstName?: string }) {
    if (!dto.phoneNumber) throw new BadRequestException('Phone required');
    return this.svc.quickCreateCustomer(dto.phoneNumber, dto.firstName);
  }

  @Get('products')
  @Roles('cashier', 'admin')
  findProducts(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('barcode') barcode?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.findProducts({
      search,
      categoryId,
      barcode,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }
}
