import { Controller, Get, Put, Body } from '@nestjs/common';
import { BlockSettingsService } from './block-settings.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('block-settings')
export class BlockSettingsController {
  constructor(private readonly svc: BlockSettingsService) {}

  @Roles('superadmin', 'admin')
  @Get()
  async get() {
    return this.svc.getSettings();
  }

  @Roles('superadmin', 'admin')
  @Put()
  async update(@Body() data: any) {
    return this.svc.updateSettings(data);
  }
}
