import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { UserRole } from '@prisma/client';

const pipe = new ValidationPipe({ whitelist: true, transform: true });

describe('Users DTOs — no override_permissions (HR-only now)', () => {
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
    const dto = plainToInstance(CreateUserDto, baseCreate);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.role).toBe(UserRole.employee);
  });

  it('override_permissions is stripped by the whitelist pipe on create (custom access lives in Employee Management only)', async () => {
    const result: CreateUserDto = await pipe.transform(
      { ...baseCreate, override_permissions: ['view_orders', 'manage_stock'] },
      { type: 'body', metatype: CreateUserDto },
    );
    expect(result).not.toHaveProperty('override_permissions');
  });

  it('override_permissions is stripped by the whitelist pipe on update', async () => {
    const result: UpdateUserDto = await pipe.transform(
      { override_permissions: ['view_orders'] },
      { type: 'body', metatype: UpdateUserDto },
    );
    expect(result).not.toHaveProperty('override_permissions');
  });

  it('CreateUserDto without override_permissions validates clean', async () => {
    const result: CreateUserDto = await pipe.transform(baseCreate, {
      type: 'body',
      metatype: CreateUserDto,
    });
    expect(result).not.toHaveProperty('override_permissions');
  });
});
