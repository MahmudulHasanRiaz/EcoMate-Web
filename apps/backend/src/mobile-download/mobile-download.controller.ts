import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { Public } from '../common/decorators/public.decorator';
import { FeatureFlagsService } from '@ecomate/feature-flags';

const APP_FEATURE_MAP: Record<string, string> = {
  storefront: 'mobile_distribution',
  admin: 'mobile_distribution_admin',
  pos: 'mobile_distribution_pos',
};

const APP_NAMES: Record<string, string> = {
  storefront: 'Storefront',
  admin: 'Admin',
  pos: 'POS',
};

@Controller('mobile-download')
export class MobileDownloadController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Public()
  @Get(':app/android')
  async downloadAndroid(
    @Param('app') app: string,
    @Res() res: Response,
  ) {
    return this.handleDownload(app, 'android', 'apk', res);
  }

  @Public()
  @Get(':app/ios')
  async downloadIos(
    @Param('app') app: string,
    @Res() res: Response,
  ) {
    return this.handleDownload(app, 'ios', 'ipa', res);
  }

  private async handleDownload(
    app: string,
    platform: 'android' | 'ios',
    ext: string,
    res: Response,
  ) {
    const feature = APP_FEATURE_MAP[app];
    if (!feature) {
      throw new NotFoundException(`Unknown app: ${app}`);
    }

    // License check
    if (!this.featureFlags.canUse(feature)) {
      throw new ForbiddenException(
        `Mobile distribution not available for ${APP_NAMES[app]}. Upgrade your license plan.`,
      );
    }

    const buildDir = process.env.MOBILE_BUILD_DIR || './mobile-builds';
    const filePath = join(buildDir, app, platform, `latest.${ext}`);

    if (!existsSync(filePath)) {
      throw new NotFoundException(
        `No ${platform.toUpperCase()} build available for ${APP_NAMES[app]} yet. ` +
        `Run the mobile build pipeline first.`,
      );
    }

    res.download(filePath, `${app}-latest.${ext}`);
  }
}
