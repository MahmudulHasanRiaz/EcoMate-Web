import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { LicenseService } from './license.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipLicenseCheck } from '../common/decorators/skip-license-check.decorator';

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

  @Public()
  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }
}
