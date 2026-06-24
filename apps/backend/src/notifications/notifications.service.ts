import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { CreateNotificationSettingDto } from './dto/create-notification-setting.dto';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { SendNotificationDto } from './dto/send-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueueService: EmailQueueService,
  ) {}

  async createSetting(dto: CreateNotificationSettingDto) {
    return this.prisma.notificationSetting.upsert({
      where: {
        channel_type: { channel: dto.channel, type: dto.type },
      },
      create: dto,
      update: dto,
    });
  }

  async findAllSettings() {
    return this.prisma.notificationSetting.findMany();
  }

  async updateSetting(id: string, dto: UpdateNotificationSettingDto) {
    const setting = await this.prisma.notificationSetting.findUnique({ where: { id } });
    if (!setting) throw new NotFoundException('Notification setting not found');
    return this.prisma.notificationSetting.update({ where: { id }, data: dto });
  }

  async removeSetting(id: string) {
    const setting = await this.prisma.notificationSetting.findUnique({ where: { id } });
    if (!setting) throw new NotFoundException('Notification setting not found');
    return this.prisma.notificationSetting.delete({ where: { id } });
  }

  async sendNotification(dto: SendNotificationDto, performedBy?: string) {
    const setting = await this.prisma.notificationSetting.findUnique({
      where: {
        channel_type: { channel: dto.channel, type: dto.eventType },
      },
    });

    if (setting && !setting.enabled) {
      return this.prisma.notificationLog.create({
        data: {
          channel: dto.channel,
          eventType: dto.eventType,
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status: 'failed',
          error: 'Notification setting is disabled',
          metadata: performedBy ? { performedBy } : {},
        },
      });
    }

    try {
      if (dto.channel === 'email') {
        await this.emailQueueService.send({
          to: dto.recipient,
          subject: dto.subject || '',
          template: 'notification',
          context: { content: dto.content },
        });
      }

      return this.prisma.notificationLog.create({
        data: {
          channel: dto.channel,
          eventType: dto.eventType,
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status: 'sent',
          metadata: performedBy ? { performedBy } : {},
        },
      });
    } catch (error: any) {
      return this.prisma.notificationLog.create({
        data: {
          channel: dto.channel,
          eventType: dto.eventType,
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status: 'failed',
          error: error.message,
          metadata: performedBy ? { performedBy } : {},
        },
      });
    }
  }

  async findAllLogs(
    page: number = 1,
    perPage: number = 20,
    channel?: string,
    status?: string,
  ) {
    const where: any = {};
    if (channel) where.channel = channel;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { sentAt: 'desc' },
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }
}
