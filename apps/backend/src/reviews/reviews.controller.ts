import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Public()
  @Get('product/:slug')
  async findByProduct(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.findByProductSlug(
      slug,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 10,
    );
  }

  @Public()
  @Post()
  async create(@Body() dto: CreateReviewDto) {
    return this.svc.create(dto);
  }

  @Public()
  @Get('latest')
  async findLatest(@Query('limit') limit?: string) {
    return this.svc.findLatest(limit ? parseInt(limit) : 6);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_reviews')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
    @Query('productId') productId?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      status,
      productId,
    });
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_reviews')
  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.svc.approve(id);
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_reviews')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
