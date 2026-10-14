import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateDispatchDto } from './create-dispatch.dto';

describe('CreateDispatchDto — minimal manual create (Task 4)', () => {
  it('accepts {orderId, courier} without identifiers', async () => {
    const dto = plainToInstance(CreateDispatchDto, {
      orderId: 'order-1',
      courier: 'steadfast',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('still requires orderId and courier', async () => {
    const missingOrder = plainToInstance(CreateDispatchDto, {
      courier: 'steadfast',
    });
    expect(await validate(missingOrder)).not.toEqual([]);

    const missingCourier = plainToInstance(CreateDispatchDto, {
      orderId: 'order-1',
    });
    expect(await validate(missingCourier)).not.toEqual([]);
  });
});
