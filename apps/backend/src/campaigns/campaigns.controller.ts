import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CampaignsService } from './campaigns.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Roles('superadmin', 'admin')
@Controller('campaigns')
@RequiresFeature('admin_campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get('templates')
  async findAllTemplates() {
    return this.campaignsService.findAllTemplates();
  }

  @Post('templates')
  async createTemplate(@Body() dto: CreateTemplateDto) {
    return this.campaignsService.createTemplate(dto);
  }

  @Put('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.campaignsService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  async removeTemplate(@Param('id') id: string) {
    return this.campaignsService.removeTemplate(id);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.campaignsService.findAll(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
      status,
    );
  }

  @Post()
  async create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.campaignsService.remove(id);
  }

  @Post(':id/send')
  async send(@Param('id') id: string) {
    return this.campaignsService.sendCampaign(id);
  }

  @Post(':id/test')
  async sendTest(@Param('id') id: string, @Body('email') email: string) {
    return this.campaignsService.sendTest(id, email);
  }
}
