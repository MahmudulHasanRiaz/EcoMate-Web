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
});
