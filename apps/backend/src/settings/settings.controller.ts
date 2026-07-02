import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateAppearanceDto } from './dto/update-appearance.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateDisplayDto } from './dto/update-display.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(@CurrentUser() user: { userId: string }) {
    return this.settingsService.getSettings(user.userId);
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.settingsService.updateProfile(user.userId, dto);
  }

  @Put('account')
  async updateAccount(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateAccountDto,
  ) {
    return this.settingsService.updateAccount(user.userId, dto);
  }

  @Put('appearance')
  async updateAppearance(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateAppearanceDto,
  ) {
    return this.settingsService.updateAppearance(user.userId, dto);
  }

  @Put('notifications')
  async updateNotifications(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateNotificationsDto,
  ) {
    return this.settingsService.updateNotifications(user.userId, dto);
  }

  @Put('display')
  async updateDisplay(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateDisplayDto,
  ) {
    return this.settingsService.updateDisplay(user.userId, dto);
  }
}
