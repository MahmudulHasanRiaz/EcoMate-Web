import { Controller, Get } from '@nestjs/common';
import { LicenseService } from './license.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('license')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  @Public()
  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }
}
