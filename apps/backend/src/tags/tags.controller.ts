import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly svc: TagsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async findAll() {
    return this.svc.findAll();
  }

  @Public()
  @Get('public')
  async findAllPublic() {
    return this.svc.findAll();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post()
  async create(@Body() dto: { name: string; slug: string }) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: { name?: string; slug?: string },
  ) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('bulk-delete')
  async bulkDelete(@Body() dto: { ids: string[] }) {
    return this.svc.bulkDelete(dto.ids);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('merge')
  async merge(@Body() dto: { keepId: string; removeId: string }) {
    return this.svc.merge(dto.keepId, dto.removeId);
  }
}
