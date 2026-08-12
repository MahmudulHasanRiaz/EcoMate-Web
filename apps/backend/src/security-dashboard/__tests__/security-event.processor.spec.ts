import { SecurityEventProcessor } from '../processors/security-event.processor';

describe('SecurityEventProcessor', () => {
  const securityEvent = { create: jest.fn() };
  const securityEventHourly = { upsert: jest.fn() };
  const securityEventDaily = { upsert: jest.fn() };
  const securityBlockDaily = { upsert: jest.fn() };

  const prisma = {
    securityEvent,
    securityEventHourly,
    securityEventDaily,
    securityBlockDaily,
  } as any;

  const processor = new SecurityEventProcessor(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    securityEvent.create.mockResolvedValue({});
    securityEventHourly.upsert.mockResolvedValue({});
    securityEventDaily.upsert.mockResolvedValue({});
    securityBlockDaily.upsert.mockResolvedValue({});
  });

  const baseJob = {
    data: {
      id: 'evt-1',
      dedupKey: 'evt-1',
      tenant: 'default',
      eventType: 'rate_limit_exceeded',
      severity: 'HIGH',
      category: 'RATE_LIMIT',
      source: 'adaptive_rate_limiter',
      actorType: 'IP',
      ipAddress: '1.2.3.4',
      metadataVersion: 1,
      metadata: {},
      retentionOverride: false,
    },
  } as any;

  it('persists the event with a valid timestamp when the job omits timestamp', async () => {
    await processor.process(baseJob);

    const createArg = securityEvent.create.mock.calls[0][0];
    expect(Number.isNaN(createArg.data.timestamp.getTime())).toBe(false);
  });

  it('uses the job timestamp when provided', async () => {
    const job = {
      data: { ...baseJob.data, timestamp: '2026-08-02T10:00:00.000Z' },
    } as any;
    await processor.process(job);

    const createArg = securityEvent.create.mock.calls[0][0];
    expect(createArg.data.timestamp.toISOString()).toBe('2026-08-02T10:00:00.000Z');
  });

  describe('tenant normalization — single-deployment canonical "default"', () => {
    const blockEvent = {
      data: {
        ...baseJob.data,
        id: 'evt-block',
        dedupKey: 'evt-block',
        eventType: 'auto_block_created',
        category: 'BLOCK',
        severity: 'HIGH',
        ipAddress: '9.9.9.9',
        // NO tenant key — as emitted by every current producer
      },
    } as any;

    it('defaults to "default" everywhere when the job omits tenant', async () => {
      const blockEventWithoutTenant = {
        data: { ...blockEvent.data },
      } as any;
      await processor.process(blockEventWithoutTenant);

      // Raw insert
      expect(securityEvent.create.mock.calls[0][0].data.tenant).toBe('default');

      // Hourly aggregate — where AND create
      const hourly = securityEventHourly.upsert.mock.calls[0][0];
      expect(hourly.where.tenant_bucket_eventType_severity_category.tenant).toBe('default');
      expect(hourly.create.tenant).toBe('default');

      // Daily aggregate
      const daily = securityEventDaily.upsert.mock.calls[0][0];
      expect(daily.where.tenant_date_eventType_severity_category.tenant).toBe('default');
      expect(daily.create.tenant).toBe('default');

      // Block daily summary
      const block = securityBlockDaily.upsert.mock.calls[0][0];
      expect(block.where.tenant_date_blockSource_targetType.tenant).toBe('default');
      expect(block.create.tenant).toBe('default');
    });

    it('a key present but undefined never reaches Prisma (all args concrete)', async () => {
      await processor.process({ data: { ...blockEvent.data, tenant: undefined } } as any);

      const calls = [
        securityEvent.create.mock.calls[0][0].data,
        securityEventHourly.upsert.mock.calls[0][0].where.tenant_bucket_eventType_severity_category,
        securityEventHourly.upsert.mock.calls[0][0].create,
        securityEventDaily.upsert.mock.calls[0][0].where.tenant_date_eventType_severity_category,
        securityEventDaily.upsert.mock.calls[0][0].create,
        securityBlockDaily.upsert.mock.calls[0][0].where.tenant_date_blockSource_targetType,
        securityBlockDaily.upsert.mock.calls[0][0].create,
      ];
      for (const arg of calls) {
        expect(arg.tenant).toBeDefined();
        expect(arg.tenant).not.toBeUndefined();
        expect(arg.tenant).toBe('default');
      }
    });

    it('uses the SAME tenant value across raw insert and all aggregates', async () => {
      const jobs = [
        { ...blockEvent.data, tenant: undefined },
        { ...blockEvent.data, tenant: 'default' },
        { ...blockEvent.data, tenant: 'acme-prod' },
      ] as any[];

      for (const job of jobs) {
        jest.clearAllMocks();
        await processor.process({ data: job } as any);

        const expected = job.tenant || 'default';
        const values = [
          securityEvent.create.mock.calls[0][0].data.tenant,
          securityEventHourly.upsert.mock.calls[0][0].create.tenant,
          securityEventDaily.upsert.mock.calls[0][0].create.tenant,
          securityBlockDaily.upsert.mock.calls[0][0].create.tenant,
        ];
        expect(values.every((v) => v === expected)).toBe(true);
      }
    });

    it('non-block events never touch the block aggregate', async () => {
      await processor.process(baseJob);

      expect(securityEventDaily.upsert).toHaveBeenCalled();
      expect(securityBlockDaily.upsert).not.toHaveBeenCalled();
    });

    it('dedupKey collision on retry is swallowed and aggregates still upsert', async () => {
      securityEvent.create.mockRejectedValueOnce({ code: 'P2002' });

      await processor.process({ data: { ...baseJob.data, tenant: undefined } } as any);

      expect(securityEventHourly.upsert).toHaveBeenCalledTimes(1);
      expect(securityEventHourly.upsert.mock.calls[0][0].create.tenant).toBe('default');
    });
  });
});
