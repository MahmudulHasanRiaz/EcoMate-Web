import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';

@Injectable()
export class OpeningBalancesService {
  constructor(private prisma: PrismaService) {}

  async setBalance(dto: SetOpeningBalanceDto) {
    if (dto.debit > 0 && dto.credit > 0) {
      throw new BadRequestException(
        'Opening balance cannot have both debit and credit',
      );
    }

    if (dto.debit === 0 && dto.credit === 0) {
      throw new BadRequestException(
        'Opening balance must have either debit or credit',
      );
    }

    const [account, period] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: dto.accountId } }),
      this.prisma.financialPeriod.findUnique({ where: { id: dto.periodId } }),
    ]);

    if (!account) {
      throw new NotFoundException(`Account with ID ${dto.accountId} not found`);
    }

    if (!period) {
      throw new NotFoundException(
        `Financial period with ID ${dto.periodId} not found`,
      );
    }

    if (period.isClosed) {
      throw new BadRequestException(
        'Cannot modify opening balances for a closed period',
      );
    }

    return this.prisma.openingBalance.upsert({
      where: {
        accountId_periodId: {
          accountId: dto.accountId,
          periodId: dto.periodId,
        },
      },
      update: {
        debit: dto.debit,
        credit: dto.credit,
      },
      create: {
        accountId: dto.accountId,
        periodId: dto.periodId,
        debit: dto.debit,
        credit: dto.credit,
      },
    });
  }

  async getBalances(periodId: string) {
    return this.prisma.openingBalance.findMany({
      where: { periodId },
      include: { account: { select: { id: true, name: true, code: true } } },
    });
  }
}
