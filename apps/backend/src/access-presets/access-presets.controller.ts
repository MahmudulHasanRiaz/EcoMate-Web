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
import { RequiresFeature } from '@ecomate/feature-flags';
import { AccessPresetsService } from './access-presets.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';

@Controller('access-presets')
@RequiresFeature('admin_access_presets')
export class AccessPresetsController {
  constructor(private readonly accessPresetsService: AccessPresetsService) {}

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: CreateAccessPresetDto) {
    return this.accessPresetsService.create(dto);
  }

  @Roles('superadmin', 'admin')
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
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.accessPresetsService.findOne(id);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccessPresetDto) {
    return this.accessPresetsService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.accessPresetsService.remove(id);
  }
}
