import { Injectable, CanActivate, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountingEnabledGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'accounting_enabled' },
      });

      if (setting?.value === 'true') {
        return true;
      }
    } catch {
      // DB not available or setting table missing - treat as disabled
    }

    throw new ServiceUnavailableException(
      'Accounting module is not enabled. Enable it in System Settings to use this feature.',
    );
  }
}
