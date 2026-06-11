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
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Public()
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
    @Query('category') category?: string,
    @Query('tagSlug') tagSlug?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('isActive') isActive?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('ids') ids?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
  ) {
    const effectiveCategoryId =
      categoryId ||
      (category ? await this.svc.resolveCategorySlug(category) : undefined);
    if (cursor) {
      return this.svc.findAllCursor({
        cursor,
        perPage: perPage ? parseInt(perPage) : undefined,
        search,
        type,
        categoryId: effectiveCategoryId,
        tagSlug: tagSlug || undefined,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isFeatured:
          isFeatured !== undefined ? isFeatured === 'true' : undefined,
        ids: ids ? ids.split(',').filter(Boolean) : undefined,
      });
    }
    const parsedMinPrice = minPrice ? parseFloat(minPrice) : undefined;
    const parsedMaxPrice = maxPrice ? parseFloat(maxPrice) : undefined;
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      type,
      categoryId: effectiveCategoryId,
      tagSlug: tagSlug || undefined,
      minPrice: parsedMinPrice,
      maxPrice: parsedMaxPrice,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      isFeatured: isFeatured !== undefined ? isFeatured === 'true' : undefined,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
      sort,
      order,
    });
  }

  @Public()
  @Get('slug/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.svc.findBySlug(slug);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/delete')
  bulkRemove(@Body() body: { ids: string[] }) {
    return this.svc.bulkRemove(body.ids);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk/update')
  bulkUpdate(@Body() body: { ids: string[]; data: UpdateProductDto }) {
    return this.svc.bulkUpdate(body.ids, body.data);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.svc.create(dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: { email: string }) {
    return this.svc.update(id, dto, user.email);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/variants/generate')
  generateVariants(@Param('id') id: string, @Body() dto: GenerateVariantsDto) {
    return this.svc.generateVariants(id, dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Put(':id/variants/:variantId')
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.svc.updateVariant(id, variantId, dto);
  }
}
