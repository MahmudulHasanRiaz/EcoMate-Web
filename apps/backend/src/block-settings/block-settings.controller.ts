import { Controller, Get, Put, Body, ValidationPipe } from '@nestjs/common';
import { BlockSettingsService } from './block-settings.service';
import { BlockSettingsDto } from './dto/block-settings.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('block-settings')
@RequiresFeature('admin_blocking')
export class BlockSettingsController {
  constructor(private readonly svc: BlockSettingsService) {}

  @Roles('superadmin', 'admin')
  @Get()
  async get() {
    return this.svc.getSettings();
  }

  @Roles('superadmin', 'admin')
  @Put()
  async update(
    @Body(new ValidationPipe({ whitelist: true })) dto: BlockSettingsDto,
  ) {
    return this.svc.updateSettings(dto);
  }
}
