import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrAttendanceService } from './hr-attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_attendance')
@RequiresFeature('admin_hr')
export class HrAttendanceController {
  constructor(private readonly hrAttendanceService: HrAttendanceService) {}

  @Post('attendance')
  createRecord(
    @Body() dto: CreateAttendanceDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrAttendanceService.createRecord(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('attendance')
  findAll(
    @Query('date') date?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrAttendanceService.findAll(
      { date, employeeId, status, departmentId },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('attendance/daily-overview')
  dailyOverview(@Query('date') date: string) {
    return this.hrAttendanceService.dailyOverview(date);
  }

  @Get('attendance/history')
  history(
    @Query('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.hrAttendanceService.history(employeeId, from, to);
  }

  @Get('attendance/:id')
  findOne(@Param('id') id: string) {
    return this.hrAttendanceService.findOne(id);
  }

  @Patch('attendance/:id')
  updateRecord(
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrAttendanceService.updateRecord(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }
}