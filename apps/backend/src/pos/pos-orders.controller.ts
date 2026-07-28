import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { PosOrdersService } from './pos-orders.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { HoldCartDto } from './dto/hold-cart.dto';
import { ValidateStockDto } from './dto/validate-stock.dto';
import { CreatePosTransferRequestDto } from './dto/create-transfer-request.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('pos')
export class PosOrdersController {
  constructor(private readonly svc: PosOrdersService) {}

  @Post('orders')
  @Roles('cashier', 'admin')
  create(
    @Body() dto: CreatePosOrderDto,
    @CurrentUser() user: { userId: string },
    @Headers('x-pos-session-id') sessionId?: string,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    if (!sessionId)
      throw new BadRequestException(
        'POS session required (x-pos-session-id header)',
      );
    return this.svc.create(dto, sessionId, user.userId, idempotencyKey);
  }

  @Get('customers')
  @Roles('cashier', 'admin')
  async findCustomer(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone required');
    return this.svc.findCustomerByPhone(phone);
  }

  @Post('customers/quick')
  @Roles('cashier', 'admin')
  async quickCreateCustomer(
    @Body() dto: { phoneNumber: string; firstName?: string },
  ) {
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
    @Query('showroomId') showroomId?: string,
  ) {
    return this.svc.findProducts({
      search,
      categoryId,
      barcode,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
      showroomId,
    });
  }

  @Post('orders/validate-stock')
  @Roles('cashier', 'admin')
  async validateStock(
    @Body() dto: ValidateStockDto,
    @Headers('x-pos-session-id') sessionId?: string,
  ) {
    if (!sessionId) {
      throw new BadRequestException('POS session required (x-pos-session-id header)');
    }
    const session = await this.svc.getSessionShowroom(sessionId);
    return this.svc.validateStock(dto, session.showroomId);
  }

  @Get('products/:id/availability')
  @Roles('cashier', 'admin')
  async productAvailability(
    @Param('id') id: string,
    @Query('variantId') variantId?: string,
    @Query('showroomId') showroomId?: string,
  ) {
    if (!showroomId) throw new BadRequestException('showroomId required');
    return this.svc.getProductAvailability(id, showroomId, variantId);
  }

  @Post('transfer-requests')
  @Roles('cashier', 'admin')
  async createTransferRequest(
    @Body() dto: CreatePosTransferRequestDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.initiateTransfer(dto, user.userId);
  }
}
