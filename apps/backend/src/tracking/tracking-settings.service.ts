import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingSettingsService {
  private readonly logger = new Logger(TrackingSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Read a system setting, falling back to an env var when the setting is absent or unreadable. */
  async get(systemKey: string, envKey: string | null): Promise<string | null> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: systemKey },
      });
      if (setting?.value) return setting.value;
    } catch (err) {
      this.logger.warn(`Failed to read setting ${systemKey}: ${err}`);
    }
    if (envKey) return this.config.get(envKey) || null;
    return null;
  }

  async isEnabled(enabledKey: string): Promise<boolean> {
    return (await this.get(enabledKey, null)) === 'true';
  }

  /**
   * test_event_code is honored only when the provider's explicit test-mode flag is set,
   * so a leftover value can never leak into production traffic (design v2 §4.11, fixes D10).
   */
  async getTestEventCode(provider: string): Promise<string | null> {
    const testMode = await this.get(`tracking_${provider}_test_mode`, null);
    if (testMode !== 'true') return null;
    return this.get(`tracking_${provider}_test_code`, null);
  }
}
