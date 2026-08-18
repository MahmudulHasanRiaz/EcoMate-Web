import { Test, TestingModule } from '@nestjs/testing';
import { EventAggregatorService } from './event-aggregator.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EventAggregatorService', () => {
  let service: EventAggregatorService;
  let prisma: PrismaService;
  let executedRaw: string[];

  beforeEach(async () => {
    executedRaw = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventAggregatorService,
        {
          provide: PrismaService,
          useValue: {
            isRestoreWriteBlocked: jest.fn().mockResolvedValue(false),
            $executeRawUnsafe: jest.fn((sql: string) => {
              executedRaw.push(sql);
              return Promise.resolve(3);
            }),
            $executeRaw: jest.fn().mockResolvedValue(0),
            securityEventHourly: {
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            securityEventDaily: {
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            securityBlockDaily: {
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            securityRetentionPolicy: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
      ],
    }).compile();

    service = module.get<EventAggregatorService>(EventAggregatorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('groups hourly recalc by the same Dhaka-truncated bucket expression as the SELECT', async () => {
    const from = new Date('2026-08-18T18:30:00Z');
    const to = new Date('2026-08-19T18:30:00Z');
    await service.recalculateHourly(from, to);

    expect(executedRaw).toHaveLength(1);
    const sql = executedRaw[0];
    const selectExpr = `date_trunc('hour', "timestamp" AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka' as bucket`;
    const groupExpr = `GROUP BY "tenant", date_trunc('hour', "timestamp" AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka', "eventType", "severity", "category"`;
    expect(sql).toContain(selectExpr);
    expect(sql).toContain(groupExpr);
    // Never group by the naive UTC expression — SELECT and GROUP BY must agree.
    expect(sql).not.toContain(`GROUP BY "tenant", date_trunc('hour', "timestamp")`);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), from.toISOString(), to.toISOString());
  });

  it('groups daily recalc by the same Dhaka-truncated date expression as the SELECT', async () => {
    const from = new Date('2026-08-18T18:00:00Z');
    const to = new Date('2026-08-19T18:00:00Z');
    await service.recalculateDaily(from, to);

    expect(executedRaw).toHaveLength(1);
    const sql = executedRaw[0];
    expect(sql).toContain(`date_trunc('day', "timestamp" AT TIME ZONE 'Asia/Dhaka')::date as day`);
    expect(sql).toContain(`GROUP BY "tenant", date_trunc('day', "timestamp" AT TIME ZONE 'Asia/Dhaka')::date, "eventType", "severity", "category"`);
    expect(sql).not.toContain(`GROUP BY "tenant", date_trunc('day', "timestamp")`);
  });

  it('cleanExpiredEvents removes stale aggregates past the cutoff', async () => {
    const res = await service.cleanExpiredEvents();
    expect(res).toEqual({ deleted: 0 });
    expect(prisma.securityEventHourly.deleteMany).toHaveBeenCalledWith({
      where: { bucket: { lt: expect.any(Date) } },
    });
    expect(prisma.securityEventDaily.deleteMany).toHaveBeenCalledWith({
      where: { date: { lt: expect.any(Date) } },
    });
    expect(prisma.securityBlockDaily.deleteMany).toHaveBeenCalledWith({
      where: { date: { lt: expect.any(Date) } },
    });
  });
});