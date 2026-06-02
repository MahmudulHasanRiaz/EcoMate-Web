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
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  GenerateVariantsDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Public()
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('ids') ids?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      type,
      categoryId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      isFeatured: isFeatured !== undefined ? isFeatured === 'true' : undefined,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
      sort,
      order,
    });
  }

  @Public()
  @Get(':id') findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
  @Post('bulk/delete') bulkRemove(@Body() body: { ids: string[] }) {
    return this.svc.bulkRemove(body.ids);
  }
  @Post('bulk/update') bulkUpdate(@Body() body: { ids: string[]; data: UpdateProductDto }) {
    return this.svc.bulkUpdate(body.ids, body.data);
  }
  @Post() create(@Body() dto: CreateProductDto) {
    return this.svc.create(dto);
  }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(id, dto);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
  @Post(':id/variants/generate')
  generateVariants(@Param('id') id: string, @Body() dto: GenerateVariantsDto) {
    return this.svc.generateVariants(id, dto);
  }
  @Put(':id/variants/:variantId')
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.svc.updateVariant(id, variantId, dto);
  }
}
