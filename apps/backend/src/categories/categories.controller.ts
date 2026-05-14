import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get()
  async findAll() { return this.svc.findAll(); }

  @Get(':id')
  async findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post()
  async create(@Body() dto: CreateCategoryDto) { return this.svc.create(dto); }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  async remove(@Param('id') id: string) { return this.svc.remove(id); }
}
