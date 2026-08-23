import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AttendanceSettingsService } from './attendance-settings.service';
import { UpdateAttendanceSettingsDto } from './dto/update-attendance-settings.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_attendance', 'manage_hr_settings')
@RequiresFeature('admin_hr')
export class AttendanceSettingsController {
  constructor(
    private readonly attendanceSettingsService: AttendanceSettingsService,
  ) {}

  @Get('attendance/settings')
  get() {
    return this.attendanceSettingsService.getSettings();
  }

  @Patch('attendance/settings')
  @PermissionsAny('manage_hr_settings')
  update(
    @Body() dto: UpdateAttendanceSettingsDto,
    @CurrentUser() user?: any,
  ) {
    return this.attendanceSettingsService.updateSettings(
      dto.mode,
      user?.userId ?? user?.id,
    );
  }
}