import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateBinLocationDto } from './dto/create-bin-location.dto';
import { UpdateBinLocationDto } from './dto/update-bin-location.dto';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  findAll(@Query('type') type?: string) {
    return this.svc.findAll(type);
  }

  @Get('bin-locations')
  findAllBinLocations(
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.svc.findAllBins(warehouseId, search, isActive);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @Roles('superadmin', 'admin')
  create(@Body() dto: CreateWarehouseDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('superadmin', 'admin')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  /* ── Bin Locations ── */

  @Get(':id/bin-locations')
  listBinLocations(@Param('id') warehouseId: string) {
    return this.svc.listBinLocations(warehouseId);
  }

  @Post(':id/bin-locations')
  @Roles('superadmin', 'admin', 'manager')
  createBinLocation(
    @Param('id') warehouseId: string,
    @Body() dto: CreateBinLocationDto,
  ) {
    return this.svc.createBinLocation(warehouseId, dto);
  }

  @Put(':id/bin-locations/:binId')
  @Roles('superadmin', 'admin', 'manager')
  updateBinLocation(
    @Param('binId') binId: string,
    @Body() dto: UpdateBinLocationDto,
  ) {
    return this.svc.updateBinLocation(binId, dto);
  }

  @Delete(':id/bin-locations/:binId')
  @Roles('superadmin', 'admin', 'manager')
  deleteBinLocation(@Param('binId') binId: string) {
    return this.svc.deleteBinLocation(binId);
  }
}
