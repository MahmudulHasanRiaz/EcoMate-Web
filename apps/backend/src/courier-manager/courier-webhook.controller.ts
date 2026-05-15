import { Controller, Post, Body, Param, Req } from '@nestjs/common';
import { CourierWebhookService } from './courier-webhook.service';
import { Public } from '../common/decorators/public.decorator';
import type { Request } from 'express';

@Controller('webhooks/courier')
export class CourierWebhookController {
  constructor(private readonly svc: CourierWebhookService) {}

  @Public()
  @Post('steadfast')
  async steadfast(@Body() body: Record<string, unknown>, @Req() req: Request) {
    this.log('Steadfast', body, req);
    return this.svc.handleSteadfast(body);
  }

  @Public()
  @Post('pathao')
  async pathao(@Body() body: Record<string, unknown>, @Req() req: Request) {
    this.log('Pathao', body, req);
    return this.svc.handlePathao(body);
  }

  @Public()
  @Post('redx')
  async redx(@Body() body: Record<string, unknown>, @Req() req: Request) {
    this.log('RedX', body, req);
    return this.svc.handleRedx(body);
  }

  @Public()
  @Post('carrybee')
  async carrybee(@Body() body: Record<string, unknown>, @Req() req: Request) {
    this.log('Carrybee', body, req);
    return this.svc.handleCarrybee(body);
  }

  private log(courier: string, body: unknown, _req: Request) {
    const logger = (require as any)('@nestjs/common').Logger;
    new logger('CourierWebhook').log(`${courier} webhook received`);
  }
}
