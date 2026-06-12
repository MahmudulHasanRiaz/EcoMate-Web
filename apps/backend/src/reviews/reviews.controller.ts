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
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

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
  async create(@Body() dto: CreateReviewDto) {
    return this.svc.create(dto);
  }

  @Public()
  @Get('latest')
  async findLatest(@Query('limit') limit?: string) {
    return this.svc.findLatest(limit ? parseInt(limit) : 6);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async findAll(@Query() query: { status?: string; productId?: string }) {
    return this.svc.findAll(query);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.svc.approve(id);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
