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
import {
  CreateZoneDto,
  UpdateZoneDto,
  CreateRackDto,
  UpdateRackDto,
  CreateShelfDto,
  UpdateShelfDto,
} from './dto/hierarchy.dto';

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
    @Query('zoneId') zoneId?: string,
    @Query('rackId') rackId?: string,
    @Query('shelfId') shelfId?: string,
  ) {
    return this.svc.findAllBins(warehouseId, search, isActive, zoneId, rackId, shelfId);
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

  /* ── Zones ── */

  @Get(':id/zones')
  listZones(@Param('id') warehouseId: string) {
    return this.svc.listZones(warehouseId);
  }

  @Post(':id/zones')
  @Roles('superadmin', 'admin', 'manager')
  createZone(
    @Param('id') warehouseId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.svc.createZone(warehouseId, dto);
  }

  @Put(':id/zones/:zoneId')
  @Roles('superadmin', 'admin', 'manager')
  updateZone(
    @Param('zoneId') zoneId: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.svc.updateZone(zoneId, dto);
  }

  @Delete(':id/zones/:zoneId')
  @Roles('superadmin', 'admin', 'manager')
  deleteZone(@Param('zoneId') zoneId: string) {
    return this.svc.deleteZone(zoneId);
  }

  /* ── Racks ── */

  @Get(':id/zones/:zoneId/racks')
  listRacks(@Param('zoneId') zoneId: string) {
    return this.svc.listRacks(zoneId);
  }

  @Post(':id/zones/:zoneId/racks')
  @Roles('superadmin', 'admin', 'manager')
  createRack(
    @Param('zoneId') zoneId: string,
    @Body() dto: CreateRackDto,
  ) {
    return this.svc.createRack({ ...dto, zoneId });
  }

  @Put(':id/zones/:zoneId/racks/:rackId')
  @Roles('superadmin', 'admin', 'manager')
  updateRack(
    @Param('rackId') rackId: string,
    @Body() dto: UpdateRackDto,
  ) {
    return this.svc.updateRack(rackId, dto);
  }

  @Delete(':id/zones/:zoneId/racks/:rackId')
  @Roles('superadmin', 'admin', 'manager')
  deleteRack(@Param('rackId') rackId: string) {
    return this.svc.deleteRack(rackId);
  }

  /* ── Shelves ── */

  @Get(':id/zones/:zoneId/racks/:rackId/shelves')
  listShelves(@Param('rackId') rackId: string) {
    return this.svc.listShelves(rackId);
  }

  @Post(':id/zones/:zoneId/racks/:rackId/shelves')
  @Roles('superadmin', 'admin', 'manager')
  createShelf(
    @Param('rackId') rackId: string,
    @Body() dto: CreateShelfDto,
  ) {
    return this.svc.createShelf({ ...dto, rackId });
  }

  @Put(':id/zones/:zoneId/racks/:rackId/shelves/:shelfId')
  @Roles('superadmin', 'admin', 'manager')
  updateShelf(
    @Param('shelfId') shelfId: string,
    @Body() dto: UpdateShelfDto,
  ) {
    return this.svc.updateShelf(shelfId, dto);
  }

  @Delete(':id/zones/:zoneId/racks/:rackId/shelves/:shelfId')
  @Roles('superadmin', 'admin', 'manager')
  deleteShelf(@Param('shelfId') shelfId: string) {
    return this.svc.deleteShelf(shelfId);
  }
}
