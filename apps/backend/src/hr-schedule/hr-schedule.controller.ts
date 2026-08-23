import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrScheduleService } from './hr-schedule.service';
import { SetScheduleDto } from './dto/set-schedule.dto';

@Controller('hr/employees')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr')
export class HrScheduleController {
  constructor(private readonly hrScheduleService: HrScheduleService) {}

  @Get(':id/schedule')
  getSchedule(@Param('id') id: string) {
    return this.hrScheduleService.getSchedule(id);
  }

  @Post(':id/schedule')
  @PermissionsAny('manage_schedule')
  setSchedule(
    @Param('id') id: string,
    @Body() dto: SetScheduleDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrScheduleService.setSchedule(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get(':id/history')
  getHistory(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrScheduleService.getHistory(
      id,
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }
}