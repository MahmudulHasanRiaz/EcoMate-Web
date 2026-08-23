import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrSelfServiceService } from './hr-self-service.service';
import { CreateSelfLeaveRequestDto } from './dto/create-self-leave-request.dto';
import { SelfAttendanceActionDto } from './dto/self-attendance-action.dto';

@Controller('hr/my')
@Roles('employee')
export class HrSelfServiceController {
  constructor(private readonly service: HrSelfServiceService) {}

  private assertEmployee(user?: any) {
    if (!user || (!user.betterAuthUserId && !user.userId)) {
      throw new UnauthorizedException('Employee session required');
    }
    return user;
  }

  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return this.service.getProfile(this.assertEmployee(user));
  }

  @Get('salary')
  getSalary(@CurrentUser() user: any) {
    return this.service.getSalary(this.assertEmployee(user));
  }

  @Get('payslips')
  getPayslips(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.service.getPayslips(
      this.assertEmployee(user),
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('payslips/:id/payments')
  getPayslipPayments(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.getPayslipPayments(this.assertEmployee(user), id);
  }

  @Get('commissions')
  getCommissions(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.service.getCommissions(
      this.assertEmployee(user),
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('earnings')
  getEarnings(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.service.getEarnings(
      this.assertEmployee(user),
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('deductions')
  getDeductions(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.service.getDeductions(
      this.assertEmployee(user),
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('schedule')
  getSchedule(@CurrentUser() user: any) {
    return this.service.getSchedule(this.assertEmployee(user));
  }

  @Get('leave-types')
  getLeaveTypes(@CurrentUser() user: any) {
    return this.service.getLeaveTypes(this.assertEmployee(user));
  }

  @Get('leave-requests')
  getLeaveRequests(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.service.getLeaveRequests(
      this.assertEmployee(user),
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('leave-requests')
  createLeaveRequest(
    @CurrentUser() user: any,
    @Body() dto: CreateSelfLeaveRequestDto,
  ) {
    return this.service.createLeaveRequest(this.assertEmployee(user), dto);
  }

  @Patch('leave-requests/:id/cancel')
  cancelLeaveRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.cancelLeaveRequest(this.assertEmployee(user), id);
  }

  @Get('attendance')
  getAttendance(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getAttendance(this.assertEmployee(user), from, to);
  }

  @Get('attendance/today')
  getTodayAttendance(
    @CurrentUser() user: any,
    @Query('date') date?: string,
  ) {
    return this.service.getTodayAttendance(this.assertEmployee(user), date);
  }

  @Post('attendance/check-in')
  checkInSelf(
    @CurrentUser() user: any,
    @Body() dto: SelfAttendanceActionDto,
  ) {
    return this.service.checkInSelf(
      this.assertEmployee(user),
      dto.note,
      dto.date,
    );
  }

  @Post('attendance/break/start')
  breakStartSelf(@CurrentUser() user: any, @Body() dto: SelfAttendanceActionDto) {
    return this.service.breakStartSelf(this.assertEmployee(user), dto.date);
  }

  @Post('attendance/break/end')
  breakEndSelf(@CurrentUser() user: any, @Body() dto: SelfAttendanceActionDto) {
    return this.service.breakEndSelf(this.assertEmployee(user), dto.date);
  }

  @Post('attendance/check-out')
  checkOutSelf(
    @CurrentUser() user: any,
    @Body() dto: SelfAttendanceActionDto,
  ) {
    return this.service.checkOutSelf(
      this.assertEmployee(user),
      dto.note,
      dto.date,
    );
  }
}
