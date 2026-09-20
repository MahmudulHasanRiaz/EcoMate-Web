import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { OrderSourcePolicyService, type OrderSourceCategory } from './order-source-policy';

@Controller('tracking/admin/source-policy')
@Roles('admin')
@RequiresFeature('admin_tracking')
export class OrderSourcePolicyController {
  constructor(private readonly sourcePolicy: OrderSourcePolicyService) {}

  /**
   * Get all source eligibility settings for the settings UI.
   */
  @Get()
  async getSettings() {
    const settings = await this.sourcePolicy.getAllSettings();
    return {
      settings,
      description:
        'Configure which order sources should have tracking events sent to advertising platforms (Meta, TikTok, etc.).',
    };
  }

  /**
   * Update a source eligibility setting.
   */
  @Post()
  async updateSetting(
    @Body() body: { category: OrderSourceCategory; enabled: boolean },
  ) {
    await this.sourcePolicy.updateSetting(body.category, body.enabled);
    return { success: true };
  }
}
