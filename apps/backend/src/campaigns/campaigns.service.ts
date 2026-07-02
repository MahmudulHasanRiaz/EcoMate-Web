import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private emailQueue: EmailQueueService,
  ) {}

  async createTemplate(dto: CreateTemplateDto) {
    return this.prisma.emailTemplate.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        body: dto.body,
        variables: dto.variables ?? undefined,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAllTemplates() {
    return this.prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTemplate(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    await this.findTemplate(id);
    const { variables, ...rest } = dto;
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...rest,
        variables: variables ?? undefined,
      },
    });
  }

  async removeTemplate(id: string) {
    await this.findTemplate(id);
    await this.prisma.emailTemplate.delete({ where: { id } });
  }

  async create(dto: CreateCampaignDto) {
    if (dto.templateId) {
      await this.findTemplate(dto.templateId);
    }
    return this.prisma.emailCampaign.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        templateId: dto.templateId,
        content: dto.content,
        recipients: dto.recipients ?? undefined,
        segmentFilter: dto.segmentFilter ?? undefined,
        scheduledAt: dto.scheduledAt,
      },
    });
  }

  async findAll(page = 1, perPage = 20, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.emailCampaign.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { template: { select: { id: true, name: true } } },
      }),
      this.prisma.emailCampaign.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const campaign = await this.prisma.emailCampaign.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findOne(id);
    if (dto.templateId) {
      await this.findTemplate(dto.templateId);
    }
    return this.prisma.emailCampaign.update({
      where: { id },
      data: {
        ...dto,
        recipients: dto.recipients ? { set: dto.recipients } : undefined,
        segmentFilter: dto.segmentFilter
          ? { set: dto.segmentFilter }
          : undefined,
      },
    });
  }

  async remove(id: string) {
    const campaign = await this.findOne(id);
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Only draft campaigns can be deleted');
    }
    await this.prisma.emailCampaign.delete({ where: { id } });
  }

  async sendCampaign(id: string) {
    const campaign = await this.findOne(id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new BadRequestException(
        'Campaign must be draft or scheduled to send',
      );
    }

    const recipients = campaign.recipients as
      | { email: string; name?: string }[]
      | null;
    if (!recipients || recipients.length === 0) {
      throw new BadRequestException('No recipients defined');
    }

    let subject = campaign.subject;
    let htmlBody = campaign.content || '';

    if (campaign.template && campaign.templateId) {
      const template = await this.findTemplate(campaign.templateId);
      subject = campaign.subject || template.subject;
      htmlBody = template.body;
    }

    if (!htmlBody) {
      throw new BadRequestException('No email content available');
    }

    await this.prisma.emailCampaign.update({
      where: { id },
      data: { status: 'sending' },
    });

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        let personalHtml = htmlBody;
        if (recipient.name) {
          personalHtml = htmlBody.replace(/\{\{name\}\}/g, recipient.name);
        }
        personalHtml = personalHtml.replace(/\{\{email\}\}/g, recipient.email);

        await this.emailQueue.send({
          to: recipient.email,
          subject,
          context: { html: personalHtml },
        });
        sent++;
      } catch {
        failed++;
      }
    }

    return this.prisma.emailCampaign.update({
      where: { id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        totalSent: sent,
        totalFailed: failed,
      },
    });
  }

  async sendTest(id: string, email: string) {
    const campaign = await this.findOne(id);

    let subject = campaign.subject;
    let htmlBody = campaign.content || '';

    if (campaign.template && campaign.templateId) {
      const template = await this.findTemplate(campaign.templateId);
      subject = campaign.subject || template.subject;
      htmlBody = template.body;
    }

    if (!htmlBody) {
      throw new BadRequestException('No email content available');
    }

    htmlBody = htmlBody.replace(/\{\{name\}\}/g, 'Test User');
    htmlBody = htmlBody.replace(/\{\{email\}\}/g, email);

    await this.emailQueue.send({
      to: email,
      subject: `[TEST] ${subject}`,
      context: { html: htmlBody },
    });

    return { message: `Test email sent to ${email}` };
  }
}
