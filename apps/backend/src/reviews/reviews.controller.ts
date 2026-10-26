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
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
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
  @RateLimitPolicy('strict_public')
  @Post()
  async create(@Body() dto: CreateReviewDto) {
    return this.svc.create(dto);
  }

  @Public()
  @Get('latest')
  async findLatest(@Query('limit') limit?: string) {
    return this.svc.findLatest(limit ? parseInt(limit) : 6);
  }

  @Permissions('view_customer_reviews')
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

  @Permissions('approve_customer_reviews')
  @RequiresFeature('admin_reviews')
  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.svc.approve(id);
  }

  @Permissions('delete_customer_reviews')
  @RequiresFeature('admin_reviews')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
