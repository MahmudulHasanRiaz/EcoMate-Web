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
import { LandingPagesService } from './landing-pages.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('landing-pages')
export class LandingPagesController {
  constructor(private readonly svc: LandingPagesService) {}

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Get()
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.svc.list({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
    });
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Public()
  @Get('published/:slug')
  findPublished(@Param('slug') slug: string) {
    return this.svc.findPublishedBySlug(slug);
  }

  @Public()
  @Get('preview/:slug')
  findPreview(@Param('slug') slug: string) {
    return this.svc.findBySlug(slug);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Post()
  create(@Body() body: Record<string, any>) {
    return this.svc.create(body);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.svc.update(id, body);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.svc.publish(id);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.svc.unpublish(id);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_landing_pages')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
