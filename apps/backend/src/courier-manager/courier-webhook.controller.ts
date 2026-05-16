import { Controller, Post, Body, Param, Req, UnauthorizedException, Logger } from '@nestjs/common';
import { CourierWebhookService } from './courier-webhook.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

@Controller('webhooks/courier')
export class CourierWebhookController {
  private readonly logger = new Logger(CourierWebhookController.name);

  constructor(
    private readonly svc: CourierWebhookService,
    private readonly prisma: PrismaService,
  ) {}

  private async validateWebhookToken(courier: string, authHeader: string | undefined): Promise<void> {
    if (!authHeader) throw new UnauthorizedException('Missing authorization header');

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Invalid authorization format');

    const creds = await this.prisma.courierCredentials.findUnique({ where: { courier } });
    if (!creds?.webhookSecret) throw new UnauthorizedException('Webhook not configured');

    if (token !== creds.webhookSecret) throw new UnauthorizedException('Invalid token');
  }

  @Post('steadfast')
  async steadfast(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const authHeader = req.headers['authorization'];
    await this.validateWebhookToken('steadfast', authHeader);
    this.logger.log('Steadfast webhook received');
    return this.svc.handleSteadfast(body);
  }

  @Post('pathao')
  async pathao(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const authHeader = req.headers['authorization'];
    await this.validateWebhookToken('pathao', authHeader);
    this.logger.log('Pathao webhook received');
    return this.svc.handlePathao(body);
  }

  @Post('redx')
  async redx(@Body() body: Record<string, unknown>, @Req() req: Request) {
    this.logger.log('RedX webhook received');
    return this.svc.handleRedx(body);
  }

  @Post('carrybee')
  async carrybee(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const authHeader = req.headers['authorization'];
    await this.validateWebhookToken('carrybee', authHeader);
    this.logger.log('Carrybee webhook received');
    return this.svc.handleCarrybee(body);
  }
}
