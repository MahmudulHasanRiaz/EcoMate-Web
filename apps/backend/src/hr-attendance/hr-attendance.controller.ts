import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrAttendanceService } from './hr-attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { BreakActionDto } from './dto/break-action.dto';
import { AdjustAttendanceDto } from './dto/adjust-attendance.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_attendance')
@RequiresFeature('admin_hr')
export class HrAttendanceController {
  constructor(private readonly hrAttendanceService: HrAttendanceService) {}

  @Post('attendance/check-in')
  checkIn(@Body() dto: CheckInDto) {
    return this.hrAttendanceService.checkIn(dto.employeeId, {
      note: dto.note,
      date: dto.date,
    });
  }

  @Post('attendance/break/start')
  breakStart(@Body() dto: BreakActionDto) {
    return this.hrAttendanceService.breakStart(dto.employeeId, {
      date: dto.date,
    });
  }

  @Post('attendance/break/end')
  breakEnd(@Body() dto: BreakActionDto) {
    return this.hrAttendanceService.breakEnd(dto.employeeId, {
      date: dto.date,
    });
  }

  @Post('attendance/check-out')
  checkOut(@Body() dto: CheckOutDto) {
    return this.hrAttendanceService.checkOut(dto.employeeId, {
      note: dto.note,
      date: dto.date,
    });
  }

  @Get('attendance/today')
  dayState(
    @Query('employeeId') employeeId: string,
    @Query('date') date?: string,
  ) {
    return this.hrAttendanceService.getDayState(employeeId, date);
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

  @Get('attendance/adjustments')
  listAdjustments(
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrAttendanceService.listAdjustments(
      employeeId,
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('attendance/adjustments')
  @PermissionsAny('manage_attendance_adjustments')
  createAdjustment(
    @Body() dto: AdjustAttendanceDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrAttendanceService.adjust(
      dto.employeeId,
      dto,
      user?.userId ?? user?.id,
    );
  }
}