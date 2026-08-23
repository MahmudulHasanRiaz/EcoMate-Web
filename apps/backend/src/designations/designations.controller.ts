import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { DesignationsService } from './designations.service';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';

@Controller('designations')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_employees')
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  @Post()
  @PermissionsAny('manage_employees')
  async create(@Body() dto: CreateDesignationDto) {
    return this.designationsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.designationsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.designationsService.findOne(id);
  }

  @Put(':id')
  @PermissionsAny('manage_employees')
  async update(@Param('id') id: string, @Body() dto: UpdateDesignationDto) {
    return this.designationsService.update(id, dto);
  }

  @Delete(':id')
  @PermissionsAny('manage_employees')
  async remove(@Param('id') id: string) {
    return this.designationsService.remove(id);
  }
}
