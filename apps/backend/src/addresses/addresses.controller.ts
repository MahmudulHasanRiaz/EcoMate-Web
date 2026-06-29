import {
  Controller, Get, Post, Put, Delete, Patch,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('addresses')
@RequiresFeature('storefront_account')
export class AddressesController {
  constructor(private readonly svc: AddressesService) {}

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.svc.findAll(user.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.findOne(user.userId, id);
  }

  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAddressDto,
  ) {
    return this.svc.create(user.userId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.svc.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.remove(user.userId, id);
  }

  @Patch(':id/default')
  setDefault(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.setDefault(user.userId, id);
  }
}
