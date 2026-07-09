import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { AuthSettingsService } from './auth-settings.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('auth-settings')
@Roles('superadmin')
export class AuthSettingsController {
  constructor(private service: AuthSettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Put(':provider')
  upsert(
    @Param('provider') provider: string,
    @Body()
    data: { isEnabled?: boolean; clientId?: string; clientSecret?: string },
  ) {
    return this.service.upsert(provider, data);
  }
}
