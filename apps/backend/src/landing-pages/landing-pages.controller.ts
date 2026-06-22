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
import type { CreateLandingPageDto, UpdateLandingPageDto } from './dto/landing-page.dto';

@Controller('landing-pages')
export class LandingPagesController {
  constructor(private readonly svc: LandingPagesService) {}

  @Roles('superadmin', 'admin')
  @Get()
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.svc.list({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
    });
  }

  @Roles('superadmin', 'admin')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Public()
  @Get('published/:slug')
  findPublished(@Param('slug') slug: string) {
    return this.svc.findPublishedBySlug(slug);
  }

  @Roles('superadmin', 'admin')
  @Post()
  create(@Body() dto: CreateLandingPageDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLandingPageDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.svc.publish(id);
  }

  @Roles('superadmin', 'admin')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.svc.unpublish(id);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
