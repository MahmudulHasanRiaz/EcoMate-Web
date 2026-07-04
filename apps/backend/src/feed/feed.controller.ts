import {
  Controller, Get, Post, Param, Query, Body, Res, HttpCode,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CreateFeedConfigDto, UpdateFeedConfigDto } from './dto/feed.dto';
import type { Response } from 'express';

@Controller('v1/feeds')
export class FeedController {
  constructor(private readonly svc: FeedService) {}

  @Public()
  @Get('catalog/:token/:platform')
  async getFeed(
    @Param('token') token: string,
    @Param('platform') platform: string,
    @Res() reply: Response,
  ) {
    await this.svc.generateFeed(token, platform, reply);
  }

  @Roles('admin', 'superadmin')
  @RequiresFeature('admin_product_feeds')
  @Get('config')
  async listConfigs() {
    return this.svc.listConfigs();
  }

  @Roles('admin', 'superadmin')
  @RequiresFeature('admin_product_feeds')
  @Post('config')
  @HttpCode(201)
  async createConfig(@Body() dto: CreateFeedConfigDto) {
    return this.svc.createConfig(dto);
  }

  @Roles('admin', 'superadmin')
  @RequiresFeature('admin_product_feeds')
  @Post('config/:id')
  async updateConfig(@Param('id') id: string, @Body() dto: UpdateFeedConfigDto) {
    return this.svc.updateConfig(id, dto);
  }

  @Roles('admin', 'superadmin')
  @RequiresFeature('admin_product_feeds')
  @Post('config/:id/regenerate-token')
  async regenerateToken(@Param('id') id: string) {
    return this.svc.regenerateToken(id);
  }

  @Roles('admin', 'superadmin')
  @RequiresFeature('admin_product_feeds')
  @Get('logs')
  async getLogs(@Query('platform') platform?: string) {
    return this.svc.getLogs(platform);
  }
}
