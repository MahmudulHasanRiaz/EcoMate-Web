import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  Res,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { CourierWebhookService } from './courier-webhook.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRedxHmac } from './webhook-verifier';

@Controller('webhooks/courier')
export class CourierWebhookController {
  private readonly logger = new Logger(CourierWebhookController.name);

  constructor(
    private readonly svc: CourierWebhookService,
    private readonly prisma: PrismaService,
  ) {}

  private async validateWebhookToken(
    courier: string,
    authHeader: string | undefined,
  ): Promise<void> {
    if (!authHeader)
      throw new UnauthorizedException('Missing authorization header');

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token)
      throw new UnauthorizedException('Invalid authorization format');

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    if (!creds?.webhookSecret)
      throw new UnauthorizedException('Webhook not configured');

    if (token !== creds.webhookSecret)
      throw new UnauthorizedException('Invalid token');
  }

  @Public()
  @Post('steadfast')
  async steadfast(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const authHeader = req.headers['authorization'];
    await this.validateWebhookToken('steadfast', authHeader);
    this.logger.log('Steadfast webhook received');
    return this.svc.handleSteadfast(body);
  }

  @Public()
  @Post('pathao')
  async pathao(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const signature = req.headers['x-pathao-signature'] as string | undefined;
    if (!signature)
      throw new UnauthorizedException('Missing X-PATHAO-Signature header');

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'pathao' },
    });
    if (!creds?.webhookSecret)
      throw new UnauthorizedException('Pathao webhook not configured');

    if (signature !== creds.webhookSecret)
      throw new UnauthorizedException('Invalid X-PATHAO-Signature');

    res.header(
      'X-Pathao-Merchant-Webhook-Integration-Secret',
      creds.pathaoIntegrationSecret || creds.webhookSecret,
    );
    res.status(202);

    this.logger.log('Pathao webhook received');
    return this.svc.handlePathao(body);
  }

  @Public()
  @Post('redx')
  async redx(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    try {
      verifyRedxHmac(
        body,
        req.headers['x-redx-signature'],
        process.env['REDX_WEBHOOK_SECRET'],
      );
    } catch (err) {
      const msg = (err as Error).message;
      // Distinguish "not configured" for server log only — caller sees same generic error
      if (msg === 'RedX webhook not configured') {
        this.logger.error('RedX webhook called but REDX_WEBHOOK_SECRET is not set');
      }
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log('RedX webhook received');
    return this.svc.handleRedx(body);
  }

  @Public()
  @Post('carrybee')
  async carrybee(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const signature = req.headers['x-carrybee-webhook-signature'] as string | undefined;
    if (!signature)
      throw new UnauthorizedException('Missing X-Carrybee-Webhook-Signature header');

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'carrybee' },
    });
    if (!creds?.webhookSecret)
      throw new UnauthorizedException('Carrybee webhook not configured');

    if (signature !== creds.webhookSecret)
      throw new UnauthorizedException('Invalid X-Carrybee-Webhook-Signature');

    res.header('X-CB-Webhook-Integration-Header', creds.webhookSecret);
    res.status(202);

    this.logger.log('Carrybee webhook received');
    return this.svc.handleCarrybee(body);
  }
}
