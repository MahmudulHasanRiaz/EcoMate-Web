import { Controller, Get, Query, Req } from '@nestjs/common';
import { SecurityService } from './security.service';
import { Public } from '../common/decorators/public.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('security')
export class SecurityController {
  constructor(private readonly svc: SecurityService) {}

  @Public()
  @Get('block-info')
  async getBlockInfo(@Query('phone') phone?: string, @Req() req?: any) {
    const ip = req?.ip || req?.raw?.socket?.remoteAddress || '';
    return this.svc.getBlockInfo(phone, ip);
  }

  @Permissions('view_security_dashboard')
  @Get('auto-block-stats')
  async getAutoBlockStats() {
    return this.svc.getAutoBlockStats();
  }
}
