import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailJob } from './email-queue.service';

@Processor('email')
export class EmailQueueProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject, context } = job.data;

    const smtpHost = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_host' } });
    const smtpPort = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_port' } });
    const smtpUser = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_user' } });
    const smtpPass = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_pass' } });
    const fromEmail = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_from_email' } });
    const fromName = await this.prisma.systemSetting.findUnique({ where: { key: 'smtp_from_name' } });

    if (!smtpHost?.value) {
      console.log(`[EmailQueue] SMTP not configured. Skipping email to ${to}: ${subject}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost.value,
      port: parseInt(smtpPort?.value || '587'),
      secure: smtpPort?.value === '465',
      auth: smtpUser?.value ? {
        user: smtpUser.value,
        pass: smtpPass?.value || '',
      } : undefined,
    });

    const html = context?.html || context?.content || subject;

    await transporter.sendMail({
      from: `"${fromName?.value || 'EcoMate'}" <${fromEmail?.value || 'noreply@ecomate.com'}>`,
      to,
      subject: subject || 'No subject',
      html,
    });

    console.log(`[EmailQueue] Email sent to ${to}: ${subject}`);
  }
}
