import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateAppearanceDto } from './dto/update-appearance.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateDisplayDto } from './dto/update-display.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { userId },
      });
    }

    return {
      profile: {
        username: settings.username,
        email: settings.email,
        bio: settings.bio,
        urls: settings.urls ? JSON.parse(settings.urls) : [],
      },
      account: {
        name: settings.accountName,
        dob: settings.accountDob,
        language: settings.accountLanguage,
      },
      appearance: {
        theme: settings.theme,
        font: settings.font,
      },
      notifications: {
        type: settings.notificationType,
        mobile: settings.notificationMobile,
        communication_emails: settings.notificationCommunicationEmail,
        social_emails: settings.notificationSocialEmail,
        marketing_emails: settings.notificationMarketingEmail,
        security_emails: settings.notificationSecurityEmail,
      },
      display: {
        items: settings.displayItems ? JSON.parse(settings.displayItems) : [],
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.urls !== undefined) data.urls = JSON.stringify(dto.urls);

    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.getSettings(userId);
  }

  async updateAccount(userId: string, dto: UpdateAccountDto) {
    const data: any = {};
    if (dto.name !== undefined) data.accountName = dto.name;
    if (dto.dob !== undefined) data.accountDob = dto.dob;
    if (dto.language !== undefined) data.accountLanguage = dto.language;

    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.getSettings(userId);
  }

  async updateAppearance(userId: string, dto: UpdateAppearanceDto) {
    const data: any = {};
    if (dto.theme !== undefined) data.theme = dto.theme;
    if (dto.font !== undefined) data.font = dto.font;

    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.getSettings(userId);
  }

  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    const data: any = {};
    if (dto.type !== undefined) data.notificationType = dto.type;
    if (dto.mobile !== undefined) data.notificationMobile = dto.mobile;
    if (dto.communication_emails !== undefined)
      data.notificationCommunicationEmail = dto.communication_emails;
    if (dto.social_emails !== undefined)
      data.notificationSocialEmail = dto.social_emails;
    if (dto.marketing_emails !== undefined)
      data.notificationMarketingEmail = dto.marketing_emails;
    if (dto.security_emails !== undefined)
      data.notificationSecurityEmail = dto.security_emails;

    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.getSettings(userId);
  }

  async updateDisplay(userId: string, dto: UpdateDisplayDto) {
    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, displayItems: JSON.stringify(dto.items) },
      update: { displayItems: JSON.stringify(dto.items) },
    });

    return this.getSettings(userId);
  }
}
