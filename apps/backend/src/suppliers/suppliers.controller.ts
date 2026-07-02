import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('superadmin', 'admin', 'manager')
@Controller('suppliers')
@RequiresFeature('admin_suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@Body() createSupplierDto: CreateSupplierDto) {
    return this.suppliersService.create(createSupplierDto);
  }

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.suppliersService.findAll(activeOnly === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(id, updateSupplierDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }

  @Post(':id/payments')
  createPayment(@Param('id') id: string, @Body() dto: CreatePaymentDto) {
    return this.suppliersService.createPayment(id, dto);
  }

  @Get(':id/payments')
  getPayments(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.suppliersService.getPayments(
      id,
      page ? +page : 1,
      perPage ? +perPage : 20,
    );
  }

  @Get('payments/:paymentId')
  getPayment(@Param('paymentId') paymentId: string) {
    return this.suppliersService.getPayment(paymentId);
  }
}
