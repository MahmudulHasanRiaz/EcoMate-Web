import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const dbOk = await this.prisma
      .$queryRawUnsafe('SELECT 1')
      .then(() => true)
      .catch((err) => {
        this.logger.error(`Health check DB ping failed: ${err.message}`);
        return false;
      });
    return {
      status: dbOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbOk ? 'ok' : 'failed',
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
    };
  }
}
