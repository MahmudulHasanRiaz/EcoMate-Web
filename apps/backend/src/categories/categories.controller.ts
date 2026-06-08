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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Public()
  @Get()
  async findAll() {
    return this.svc.findAll();
  }

  @Public()
  @Get('menu')
  async getMenuCategories() {
    return this.svc.findMenuCategories();
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
