import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CancelCarrybeeOrderDto } from '../dto/cancel-carrybee-order.dto';
import { CourierManagerController } from '../courier-manager.controller';

/**
 * LOW-b RED phase — cancel DTO must require reason; missing body → 400 not 500.
 */
describe('CancelCarrybeeOrderDto validation', () => {
  it('rejects a missing reason', async () => {
    const dto = plainToInstance(CancelCarrybeeOrderDto, {} as any);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('CourierManagerController.cancelCarrybeeOrder missing body', () => {
  it('missing body throws 400 (BadRequest), not a 500 TypeError', async () => {
    const svc = {
      cancelCarrybeeOrder: jest.fn().mockRejectedValue(
        Object.assign(new Error('Carrybee cancellation_reason is required'), {
          status: 400,
        }),
      ),
    };
    const controller = new CourierManagerController(
      svc as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    let caught: any = null;
    try {
      await controller.cancelCarrybeeOrder('CBX-1', undefined as any);
    } catch (e: any) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    // TypeError (500-class, no status) is the bug; BadRequest (400) is the fix.
    expect(caught instanceof TypeError).toBe(false);
  });
});
