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
  ClearShiftRotationDto,
  UpdateShiftPresetDto,
  BulkSetRotationDto,
  QuickAssignPresetDto,
  FindOrCreateCustomPresetDto,
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

  @Post('custom-preset')
  @PermissionsAny('manage_schedule')
  findOrCreateCustom(@Body() dto: FindOrCreateCustomPresetDto) {
    return this.shifts.findOrCreateCustomPreset(dto);
  }

  @Post('employees/:id/bulk-rotation')
  @PermissionsAny('manage_schedule')
  bulkSetRotation(
    @Param('id') id: string,
    @Body() dto: BulkSetRotationDto,
    @CurrentUser() user?: any,
  ) {
    return this.shifts.bulkSetRotation(
      id,
      dto.rotations,
      user?.userId ?? user?.id,
    );
  }

  @Post('employees/:id/quick-assign')
  @PermissionsAny('manage_schedule')
  quickAssign(
    @Param('id') id: string,
    @Body() dto: QuickAssignPresetDto,
    @CurrentUser() user?: any,
  ) {
    return this.shifts.quickAssignPreset(
      id,
      dto.shiftPresetId,
      dto.days,
      user?.userId ?? user?.id,
    );
  }

  @Delete('employees/:id/rotation')
  @PermissionsAny('manage_schedule')
  clearRotation(
    @Param('id') id: string,
    // dayOfWeek only — sending a preset here made no sense and the shared DTO
    // required one, so every "No shift" save returned 400.
    @Body() dto: ClearShiftRotationDto,
    @CurrentUser() user?: any,
  ) {
    return this.shifts.clearRotationDay(
      id,
      dto.dayOfWeek,
      user?.userId ?? user?.id,
    );
  }
}