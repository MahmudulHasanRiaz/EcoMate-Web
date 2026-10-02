import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ShiftService } from './hr-shifts.service';
import {
  CreateShiftPresetDto,
  SetShiftRotationDto,
  UpdateShiftPresetDto,
} from './dto/shift.dto';

@Controller('hr/shifts')
@Roles('superadmin', 'admin', 'manager')
@RequiresFeature('admin_hr')
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get()
  @PermissionsAny('view_hr')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.shifts.listPresets(includeInactive === 'true');
  }

  @Get('presets/:id')
  @PermissionsAny('view_hr')
  get(@Param('id') id: string) {
    return this.shifts.getPreset(id);
  }

  @Post()
  @PermissionsAny('manage_schedule')
  create(@Body() dto: CreateShiftPresetDto) {
    return this.shifts.createPreset(dto);
  }

  @Put('presets/:id')
  @PermissionsAny('manage_schedule')
  update(@Param('id') id: string, @Body() dto: UpdateShiftPresetDto) {
    return this.shifts.updatePreset(id, dto);
  }

  @Delete('presets/:id')
  @PermissionsAny('manage_schedule')
  deactivate(@Param('id') id: string) {
    return this.shifts.deactivatePreset(id);
  }

  @Get('employees/:id/rotation')
  @PermissionsAny('view_hr')
  rotation(@Param('id') id: string) {
    return this.shifts.getRotation(id);
  }

  @Post('employees/:id/rotation')
  @PermissionsAny('manage_schedule')
  setRotation(
    @Param('id') id: string,
    // A DTO, not @Body('field'): named-property binding silently produced
    // `undefined` when the payload shape varied, which surfaced as a Prisma
    // validation error (500) instead of a validation message.
    @Body() dto: SetShiftRotationDto,
    @CurrentUser() user?: any,
  ) {
    return this.shifts.setRotationDay(
      id,
      dto.dayOfWeek,
      dto.shiftPresetId,
      user?.userId ?? user?.id,
    );
  }

  @Delete('employees/:id/rotation')
  @PermissionsAny('manage_schedule')
  clearRotation(
    @Param('id') id: string,
    @Body() dto: SetShiftRotationDto,
    @CurrentUser() user?: any,
  ) {
    return this.shifts.clearRotationDay(
      id,
      dto.dayOfWeek,
      user?.userId ?? user?.id,
    );
  }
}