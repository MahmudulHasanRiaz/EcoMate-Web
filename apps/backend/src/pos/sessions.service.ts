import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async open(dto: OpenSessionDto, cashierId: string) {
    const active = await this.prisma.posSession.findFirst({
      where: { cashierId, showroomId: dto.showroomId, status: 'open' },
    });
    if (active) {
      throw new BadRequestException(
        'Active session already exists for this showroom',
      );
    }

    const showroom = await this.prisma.warehouse.findUnique({
      where: { id: dto.showroomId },
    });
    if (!showroom || showroom.type !== 'showroom') {
      throw new BadRequestException('Invalid showroom');
    }

    return this.prisma.posSession.create({
      data: {
        showroomId: dto.showroomId,
        cashierId,
        openingBalance: dto.openingBalance,
      },
      include: { showroom: true },
    });
  }

  async getActive(cashierId: string, showroomId: string) {
    return this.prisma.posSession.findFirst({
      where: { cashierId, showroomId, status: 'open' },
      include: { showroom: true },
    });
  }

  async close(id: string, dto: CloseSessionDto, cashierId: string) {
    const session = await this.prisma.posSession.findFirst({
      where: { id, cashierId, status: 'open' },
      include: { orders: { where: { paymentStatus: 'PAID' } } },
    });
    if (!session) throw new NotFoundException('Active session not found');

    const totalSales = session.orders.reduce(
      (sum, o) => sum + Number(o.total),
      0,
    );
    const expectedBalance = Number(session.openingBalance) + totalSales;

    return this.prisma.posSession.update({
      where: { id },
      data: {
        status: 'closed',
        closingBalance: dto.closingBalance,
        expectedBalance,
        notes: dto.notes,
        closedAt: new Date(),
      },
    });
  }

  async getOrders(id: string) {
    return this.prisma.order.findMany({
      where: { posSessionId: id },
      include: { items: true, payments: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
