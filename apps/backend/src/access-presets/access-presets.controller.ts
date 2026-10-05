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
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { AccessPresetsService } from './access-presets.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';

@Controller('access-presets')
@RequiresFeature('admin_access_presets')
export class AccessPresetsController {
  constructor(private readonly accessPresetsService: AccessPresetsService) {}

  /**
   * `@Roles('superadmin', 'admin')` is deliberately kept on every handler even
   * though `manage_presets` is now enforced as well. RolesGuard runs before
   * PermissionsGuard in the global chain, so a preset that grants
   * `manage_presets` still cannot hand edit rights over the presets that
   * granted it — without the role gate, a preset could escalate itself.
   */
  @Roles('superadmin', 'admin')
  @Permissions('manage_presets')
  @Post()
  async create(@Body() dto: CreateAccessPresetDto) {
    return this.accessPresetsService.create(dto);
  }

  @Roles('superadmin', 'admin')
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

  @Roles('superadmin', 'admin')
  @Permissions('manage_presets')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.accessPresetsService.findOne(id);
  }

  @Roles('superadmin', 'admin')
  @Permissions('manage_presets')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccessPresetDto) {
    return this.accessPresetsService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Permissions('manage_presets')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.accessPresetsService.remove(id);
  }
}