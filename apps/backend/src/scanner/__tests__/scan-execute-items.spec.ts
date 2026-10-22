import { ValidationPipe } from '@nestjs/common';
import { ScanExecuteDto } from '../dto/scanner.dto';
import { ScannerController } from '../scanner.controller';

/**
 * Regression: staged receive rows carry the operator's damaged split, but the
 * HTTP boundary silently dropped it.
 *
 * The global ValidationPipe runs with `whitelist: true`, so an undecorated
 * `items` property is stripped before the controller runs; the controller also
 * forwarded only the identifier/selection fields. Every receive entry point
 * (scanner staging, RETURN_RECEIVE, detail-page mark-received) must persist the
 * same `damagedQuantity` + `damageLog(phase: 'receive')`.
 */
describe('scanner execute — staged receive items survive the HTTP boundary', () => {
  const dispatchId = '11111111-1111-4111-8111-111111111111';
  const productId = '22222222-2222-4222-8222-222222222222';
  const items = [
    { productId, variantId: null, quantity: 1, damagedQuantity: 1 },
  ];

  it('keeps items + damagedQuantity through the global whitelist pipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const dto = (await pipe.transform(
      {
        purpose: 'DISPATCH_RETURN',
        identifier: 'ORD-261022-0001',
        dispatchId,
        items,
      },
      { type: 'body', metatype: ScanExecuteDto },
    )) as ScanExecuteDto;

    expect((dto as any).items).toEqual(items);
  });

  it('forwards the items to the purpose handler', async () => {
    const execute = jest.fn().mockResolvedValue({ status: 'success' });
    const controller = new ScannerController({ execute } as any);

    await controller.scan(
      {
        purpose: 'DISPATCH_RETURN',
        identifier: 'ORD-261022-0001',
        dispatchId,
        items,
      } as any,
      { userId: 'staff-1', email: 'staff@ecomate.com' },
    );

    expect(execute).toHaveBeenCalledWith(
      'DISPATCH_RETURN',
      expect.objectContaining({ items }),
      { userId: 'staff-1', email: 'staff@ecomate.com' },
    );
  });
});
