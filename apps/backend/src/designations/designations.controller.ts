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
import { DesignationsService } from './designations.service';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';

@Controller('designations')
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: CreateDesignationDto) {
    return this.designationsService.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Get()
  async findAll() {
    return this.designationsService.findAll();
  }

  @Roles('superadmin', 'admin')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.designationsService.findOne(id);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDesignationDto) {
    return this.designationsService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.designationsService.remove(id);
  }
}
