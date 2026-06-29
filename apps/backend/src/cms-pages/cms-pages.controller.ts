import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { CmsPagesService } from './cms-pages.service';
import { CreateCmsPageDto, UpdateCmsPageDto } from './dto/cms-page.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('cms-pages')
export class CmsPagesController {
  constructor(private readonly svc: CmsPagesService) {}

  @Public()
  @Get('footer')
  async findActiveForFooter() {
    return this.svc.findActiveForFooter();
  }

  @Public()
  @Get('slug/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.svc.findBySlug(slug);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_cms')
  @Get()
  async findAll() {
    return this.svc.findAll();
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_cms')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_cms')
  @Post()
  async create(@Body() dto: CreateCmsPageDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_cms')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCmsPageDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_cms')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
