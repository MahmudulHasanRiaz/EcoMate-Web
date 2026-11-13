import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { StoreLocationsService } from './store-locations.service';
import {
  CreateStoreLocationDto,
  UpdateStoreLocationDto,
} from './dto/store-location.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

/**
 * Store locations (Stores / Outlets).
 *
 * Public routes serve the storefront `/stores` page: active locations only.
 * Admin routes live under `/store-locations/admin*` because the public list
 * already occupies `GET /store-locations` — one path cannot be both public
 * and role-guarded. Admin list/detail include inactive locations so staff
 * can manage them.
 *
 * Feature gate: `admin_cms` — the same key the CMS/Pages area uses
 * (cms-pages.controller.ts). Note it is a backend guard string, not a
 * `FEATURES` catalogue key (the catalogue only has `admin_cms_pages`,
 * which the sidebar entry uses).
 */
@Controller('store-locations')
export class StoreLocationsController {
  constructor(private readonly svc: StoreLocationsService) {}

  @Public()
  @Get()
  async findAllPublic() {
    return this.svc.findAllPublic();
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_cms')
  @Get('admin')
  async findAllAdmin() {
    return this.svc.findAllAdmin();
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_cms')
  @Get('admin/:id')
  async findOneAdmin(@Param('id') id: string) {
    return this.svc.findOneAdmin(id);
  }

  @Public()
  @Get(':id')
  async findOnePublic(@Param('id') id: string) {
    return this.svc.findOnePublic(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_cms')
  @Post()
  async create(@Body() dto: CreateStoreLocationDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_cms')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStoreLocationDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_cms')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
