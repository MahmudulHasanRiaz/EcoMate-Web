import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Public()
  @Get('product/:slug')
  async findByProduct(@Param('slug') slug: string) {
    return this.svc.findByProductSlug(slug);
  }

  @Public()
  @Post()
  async create(@Body() dto: { productId: string; customerName: string; rating: number; text?: string }) {
    return this.svc.create(dto);
  }
}
