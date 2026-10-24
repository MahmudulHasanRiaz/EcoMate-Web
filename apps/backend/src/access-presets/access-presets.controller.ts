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
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { assertNoEscalation } from '../common/permissions/no-escalation';
import { RequiresFeature } from '@ecomate/feature-flags';
import { AccessPresetsService } from './access-presets.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';

@Controller('access-presets')
@RequiresFeature('admin_access_presets')
export class AccessPresetsController {
  constructor(private readonly accessPresetsService: AccessPresetsService) {}

  /**
   * Preset supremacy (owner 2026-10-24): NO role gate here. The old
   * `@Roles('superadmin','admin')` gate blocked preset holders with
   * `manage_presets` from managing presets at all. Self-escalation is
   * prevented capability-side instead: an actor may only grant permissions
   * they already hold (assertNoEscalation below), so a preset can never be
   * edited into something broader than its editor.
   */
  @Permissions('manage_presets')
  @Post()
  async create(@Body() dto: CreateAccessPresetDto, @CurrentUser() user?: any) {
    assertNoEscalation(user?.permissions, dto.permissions, 'access preset');
    return this.accessPresetsService.create(dto);
  }

  @Permissions('manage_presets')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const perPageNum = perPage ? parseInt(perPage, 10) : 20;
    return this.accessPresetsService.findAll(pageNum, perPageNum, search);
  }

  @Permissions('manage_presets')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.accessPresetsService.findOne(id);
  }

  @Permissions('manage_presets')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccessPresetDto, @CurrentUser() user?: any) {
    assertNoEscalation(user?.permissions, dto.permissions, 'access preset');
    return this.accessPresetsService.update(id, dto);
  }

  @Permissions('manage_presets')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.accessPresetsService.remove(id);
  }
}