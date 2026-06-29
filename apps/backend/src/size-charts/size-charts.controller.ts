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
import { RequiresFeature } from '@ecomate/feature-flags';
import { SizeChartsService } from './size-charts.service';
import { CreateSizeChartDto, UpdateSizeChartDto } from './dto/size-chart.dto';

@Controller('size-charts')
export class SizeChartsController {
  constructor(private readonly svc: SizeChartsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_size_charts')
  @Get()
  async findAll() {
    return this.svc.findAll();
  }

  @Public()
  @Get('by-product/:slug')
  async findByProductSlug(@Param('slug') slug: string) {
    const result = await this.svc.findByProductSlug(slug);
    if (!result) return null;
    return result;
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_size_charts')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_size_charts')
  @Post()
  async create(@Body() dto: CreateSizeChartDto) {
    return this.svc.create(dto);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_size_charts')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSizeChartDto) {
    return this.svc.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_size_charts')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
