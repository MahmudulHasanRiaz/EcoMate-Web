import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, GenerateVariantsDto } from './dto/product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get()
  findAll(
    @Query('page') page?: string, @Query('perPage') perPage?: string,
    @Query('search') search?: string, @Query('type') type?: string,
    @Query('categoryId') categoryId?: string, @Query('isActive') isActive?: string,
    @Query('sort') sort?: string, @Query('order') order?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined, perPage: perPage ? parseInt(perPage) : undefined,
      search, type, categoryId, isActive: isActive !== undefined ? isActive === 'true' : undefined, sort, order,
    });
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: CreateProductDto) { return this.svc.create(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateProductDto) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Post(':id/variants/generate')
  generateVariants(@Param('id') id: string, @Body() dto: GenerateVariantsDto) { return this.svc.generateVariants(id, dto); }
}
