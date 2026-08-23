import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { UserRole } from '@prisma/client';

const pipe = new ValidationPipe({ whitelist: true, transform: true });

describe('Users DTOs — override_permissions', () => {
  const baseCreate = {
    firstName: 'Jane',
    lastName: 'Smith',
    username: 'janesmith',
    email: 'jane@example.com',
    phoneNumber: '01798765432',
    password: 'securepassword',
    role: UserRole.employee,
  };

  it('CreateUserDto accepts role employee via @IsEnum(UserRole)', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...baseCreate,
      override_permissions: ['view_orders'],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.role).toBe(UserRole.employee);
  });

  it('CreateUserDto override_permissions survives whitelist ValidationPipe transform', async () => {
    const result: CreateUserDto = await pipe.transform(
      { ...baseCreate, override_permissions: ['view_orders', 'manage_stock'] },
      { type: 'body', metatype: CreateUserDto },
    );
    expect(result.override_permissions).toEqual([
      'view_orders',
      'manage_stock',
    ]);
  });

  it('CreateUserDto rejects non-string entries in override_permissions', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...baseCreate,
      override_permissions: ['view_orders', 123],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'override_permissions')).toBe(
      true,
    );
  });

  it('CreateUserDto override_permissions optional (omitted → undefined)', async () => {
    const result: CreateUserDto = await pipe.transform(baseCreate, {
      type: 'body',
      metatype: CreateUserDto,
    });
    expect(result.override_permissions).toBeUndefined();
  });

  it('UpdateUserDto override_permissions survives whitelist ValidationPipe transform', async () => {
    const result: UpdateUserDto = await pipe.transform(
      { override_permissions: ['view_orders'] },
      { type: 'body', metatype: UpdateUserDto },
    );
    expect(result.override_permissions).toEqual(['view_orders']);
  });

  it('UpdateUserDto override_permissions: empty array and undefined both valid', async () => {
    const empty = await pipe.transform(
      { override_permissions: [] },
      { type: 'body', metatype: UpdateUserDto },
    );
    expect(empty.override_permissions).toEqual([]);

    const omitted = await pipe.transform(
      {},
      { type: 'body', metatype: UpdateUserDto },
    );
    expect(omitted.override_permissions).toBeUndefined();
  });

  it('UpdateUserDto rejects non-string override_permissions entries', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      override_permissions: [true],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'override_permissions')).toBe(
      true,
    );
  });
});