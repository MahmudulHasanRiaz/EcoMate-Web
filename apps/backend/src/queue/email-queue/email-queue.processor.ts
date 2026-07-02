import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailJob } from './email-queue.service';

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_email', 'smtp_from_name'] as const;

@Processor('email')
export class EmailQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject, context } = job.data;

    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: SMTP_KEYS as unknown as string[] } },
    });
    const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]));

    if (!cfg['smtp_host']) {
      this.logger.log(`SMTP not configured. Skipping email to ${to}: ${subject}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: cfg['smtp_host'],
      port: parseInt(cfg['smtp_port'] || '587'),
      secure: cfg['smtp_port'] === '465',
      auth: cfg['smtp_user'] ? {
        user: cfg['smtp_user'],
        pass: cfg['smtp_pass'] || '',
      } : undefined,
    });

    try {
      const html = context?.html || context?.content || '';
      const text = context?.text || undefined;

      await transporter.sendMail({
        from: `"${cfg['smtp_from_name'] || 'EcoMate'}" <${cfg['smtp_from_email'] || 'noreply@ecomate.com'}>`,
        to,
        subject: subject || 'No subject',
        html: html || undefined,
        text,
      });

      this.logger.log(`Email sent to ${to}: ${subject}`);
    } finally {
      transporter.close();
    }
  }
}
