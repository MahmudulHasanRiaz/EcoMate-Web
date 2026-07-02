import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailQueueService } from '../email-queue.service';

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  const mockQueue = { add: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(EmailQueueService);
  });

  it('adds email job to queue', async () => {
    await service.send({
      to: 'test@test.com',
      subject: 'Test',
      template: 'test',
      context: {},
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'send',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
