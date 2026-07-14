import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { BulkDeleteTagsDto } from './dto/bulk-delete-tags.dto';
import { MergeTagsDto } from './dto/merge-tags.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly svc: TagsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Get()
  async findAll(@Query('search') search?: string) {
    return this.svc.findAll(search);
  }

  @Public()
  @Get('public')
  async findAllPublic() {
    return this.svc.findAll();
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Post()
  async create(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateTagDto,
  ) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateTagDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Post('bulk-delete')
  async bulkDelete(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: BulkDeleteTagsDto,
  ) {
    return this.svc.bulkDelete(dto.ids);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_tags')
  @Post('merge')
  async merge(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: MergeTagsDto,
  ) {
    return this.svc.merge(dto.keepId, dto.removeId);
  }
}
