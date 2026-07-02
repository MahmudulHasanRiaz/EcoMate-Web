import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const dbOk = await this.prisma
      .$queryRawUnsafe('SELECT 1')
      .then(() => true)
      .catch(() => false);
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

  @Public()
  @Get('db-columns')
  async getDbColumns() {
    try {
      const productCols = await this.prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'Product'
      `);
      const variantCols = await this.prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'ProductVariant'
      `);
      return { 
        success: true, 
        productColumns: productCols,
        variantColumns: variantCols
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
