import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { LicenseService } from './license.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipLicenseCheck } from '../common/decorators/skip-license-check.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('license')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  @Public()
  @SkipLicenseCheck()
  @Post('activate')
  async activate(@Body() dto: ActivateLicenseDto, @Req() req: any) {
    const domain = req.hostname;
    return this.licenseService.activateWithKeymate(dto.licenseKey, domain, dto.apiKey);
  }

  @SkipLicenseCheck()
  @Post('sync')
  @Roles('superadmin', 'admin')
  async sync() {
    return this.licenseService.sync();
  }

  @Public()
  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }
}
