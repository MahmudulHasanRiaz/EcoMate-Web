import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import {
  CreateShippingOptionDto,
  UpdateShippingOptionDto,
  CreateShippingZoneGroupDto,
  UpdateShippingZoneGroupDto,
} from './dto/shipping.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('shipping')
@Roles('superadmin', 'admin', 'manager')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('options')
  findAllOptions() {
    return this.shippingService.findAllOptions();
  }

  @Post('options')
  createOption(@Body() dto: CreateShippingOptionDto) {
    return this.shippingService.createOption(dto);
  }

  @Put('options/:id')
  updateOption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingOptionDto,
  ) {
    return this.shippingService.updateOption(id, dto);
  }

  @Delete('options/:id')
  deleteOption(@Param('id', ParseUUIDPipe) id: string) {
    return this.shippingService.deleteOption(id);
  }

  @Get('zones')
  findAllZoneGroups() {
    return this.shippingService.findAllZoneGroups();
  }

  @Post('zones')
  createZoneGroup(@Body() dto: CreateShippingZoneGroupDto) {
    return this.shippingService.createZoneGroup(dto);
  }

  @Put('zones/:id')
  updateZoneGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingZoneGroupDto,
  ) {
    return this.shippingService.updateZoneGroup(id, dto);
  }

  @Delete('zones/:id')
  deleteZoneGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.shippingService.deleteZoneGroup(id);
  }
}
