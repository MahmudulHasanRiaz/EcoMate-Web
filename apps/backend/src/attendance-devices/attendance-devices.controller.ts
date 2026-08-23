import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AttendanceDevicesService } from './attendance-devices.service';
import { CreateAttendanceDeviceDto } from './dto/create-attendance-device.dto';
import { UpdateAttendanceDeviceDto } from './dto/update-attendance-device.dto';
import { CreateDeviceMappingDto } from './dto/create-device-mapping.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_attendance_devices')
@RequiresFeature('admin_hr')
export class AttendanceDevicesController {
  constructor(
    private readonly attendanceDevicesService: AttendanceDevicesService,
  ) {}

  @Get('attendance/devices')
  list() {
    return this.attendanceDevicesService.listDevices();
  }

  @Post('attendance/devices')
  create(
    @Body() dto: CreateAttendanceDeviceDto,
    @CurrentUser() user?: any,
  ) {
    return this.attendanceDevicesService.createDevice(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Patch('attendance/devices/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDeviceDto) {
    return this.attendanceDevicesService.updateDevice(id, dto as any);
  }

  @Delete('attendance/devices/:id')
  remove(@Param('id') id: string) {
    return this.attendanceDevicesService.deleteDevice(id);
  }

  @Post('attendance/devices/:id/test')
  test(@Param('id') id: string) {
    return this.attendanceDevicesService.testConnection(id);
  }

  @Post('attendance/devices/:id/sync')
  @HttpCode(200)
  sync(@Param('id') id: string) {
    return this.attendanceDevicesService.syncDevice(id);
  }

  @Get('attendance/devices/:id/mappings')
  listMappings(@Param('id') id: string) {
    return this.attendanceDevicesService.listMappings(id);
  }

  @Post('attendance/devices/:id/mappings')
  createMapping(
    @Param('id') id: string,
    @Body() dto: CreateDeviceMappingDto,
  ) {
    return this.attendanceDevicesService.createMapping(id, dto);
  }

  @Delete('attendance/devices/:id/mappings/:mappingId')
  deleteMapping(@Param('id') id: string, @Param('mappingId') mappingId: string) {
    return this.attendanceDevicesService.deleteMapping(id, mappingId);
  }

  @Post('attendance/devices/:id/events')
  @HttpCode(200)
  ingest(
    @Param('id') id: string,
    @Body() body: { events?: any[] } | string,
  ) {
    return this.attendanceDevicesService.ingestEvents(id, body);
  }

  @Get('attendance/devices/:id/events')
  listEvents(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('perPage', new ParseIntPipe({ optional: true })) perPage?: number,
  ) {
    return this.attendanceDevicesService.listEvents(
      id,
      status,
      page ?? 1,
      perPage ?? 50,
    );
  }
}