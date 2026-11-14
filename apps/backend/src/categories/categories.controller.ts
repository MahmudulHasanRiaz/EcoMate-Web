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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  /**
   * Full-set list. `?isActive=true|false` filters by active flag — the
   * storefront sitemap relies on `?isActive=true` so inactive categories
   * are never listed. Any other value (or none) means "no filter", which
   * preserves the admin's unfiltered list.
   */
  @Public()
  @Get()
  async findAll(@Query('isActive') isActive?: string) {
    const filter: { isActive?: boolean } = {};
    if (isActive === 'true') filter.isActive = true;
    else if (isActive === 'false') filter.isActive = false;
    return this.svc.findAll(filter);
  }

  @Public()
  @Get('menu')
  async getMenuCategories() {
    return this.svc.findMenuCategories();
  }

  @Public()
  @Get('tree')
  async findTree() {
    return this.svc.findTree();
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_products')
  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_products')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_products')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
