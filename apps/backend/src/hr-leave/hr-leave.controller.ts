import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrLeaveService } from './hr-leave.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_leave')
@RequiresFeature('admin_hr')
export class HrLeaveController {
  constructor(private readonly hrLeaveService: HrLeaveService) {}

  @Post('leave-types')
  createType(@Body() dto: CreateLeaveTypeDto, @CurrentUser() user?: any) {
    return this.hrLeaveService.createType(dto);
  }

  @Get('leave-types')
  listTypes(@Query('isActive') isActive?: string) {
    return this.hrLeaveService.listTypes({
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Patch('leave-types/:id')
  updateType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.hrLeaveService.updateType(id, dto);
  }

  @Delete('leave-types/:id')
  deleteType(@Param('id') id: string) {
    return this.hrLeaveService.deleteType(id);
  }

  @Post('leave-requests')
  createRequest(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrLeaveService.createRequest(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('leave-requests')
  listRequests(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrLeaveService.listRequests(
      { employeeId, status },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Patch('leave-requests/:id/approve')
  approveRequest(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrLeaveService.approveRequest(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Patch('leave-requests/:id/reject')
  rejectRequest(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrLeaveService.rejectRequest(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Patch('leave-requests/:id/cancel')
  cancelRequest(@Param('id') id: string, @CurrentUser() user?: any) {
    return this.hrLeaveService.cancelRequest(id, user?.userId ?? user?.id);
  }

  @Get('leave-balances')
  leaveBalances(@Query('employeeId') employeeId: string) {
    return this.hrLeaveService.leaveBalances(employeeId);
  }

  @Get('leave-calendar')
  leaveCalendar(
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.hrLeaveService.leaveCalendar({
      employeeId,
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }
}
