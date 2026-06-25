import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense-category.dto';

@Roles('superadmin', 'admin', 'manager')
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly svc: ExpenseCategoriesService) {}

  @Get()
  async findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateExpenseCategoryDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
