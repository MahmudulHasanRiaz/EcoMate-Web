import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { LicenseService } from './license.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { SkipLicenseCheck } from '../common/decorators/skip-license-check.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('license')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  /**
   * Activate or replace the license.
   *
   * Requires an admin session. This endpoint used to be @Public(), which meant
   * any anonymous visitor who could reach the backend could overwrite the
   * license of a live deployment: @Public short-circuits DualModeAuthGuard
   * before any token is examined, and with no @Roles metadata the remaining
   * guards all pass too.
   *
   * There is deliberately no anonymous bootstrap path. A fresh deployment seeds
   * its super admin from ADMIN_EMAIL/ADMIN_PASSWORD at startup, so an owner
   * signs in with those credentials and activates here. Adding a bypass to
   * make first-run easier would reintroduce exactly the hole this closes.
   *
   * @SkipLicenseCheck is required: a deployment whose license has lapsed must
   * still be able to renew it, or it would be permanently unrecoverable.
   */
  @SkipLicenseCheck()
  @Post('activate')
  @Roles('superadmin', 'admin')
  async activate(@Body() dto: ActivateLicenseDto, @Req() req: any) {
    const domain = req.hostname;
    return this.licenseService.activateWithKeymate(
      dto.licenseKey,
      domain,
      dto.apiKey,
      req.user?.userId,
      req.ip,
    );
  }

  /** Re-verify the stored license against the license server. */
  @SkipLicenseCheck()
  @Post('sync')
  @Roles('superadmin', 'admin')
  async sync() {
    return this.licenseService.sync();
  }

  /**
   * License status.
   *
   * Public, because the admin app calls it before a user is signed in — the
   * sign-in screen shows whether the deployment is licensed. So the anonymous
   * shape is reduced to what the UI genuinely needs to render that message.
   *
   * The previous response included the full LicenseInfo: plan name, price,
   * every unlocked feature, usage limits and the authorised domains. That is
   * reconnaissance handed to any anonymous visitor, so it now requires an admin
   * session; see getStatus({ includeDetails }).
   */
  @Public()
  @Get('status')
  getStatus(@CurrentUser() user?: any) {
    const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';
    return this.licenseService.getStatus({ includeDetails: isAdmin });
  }
}