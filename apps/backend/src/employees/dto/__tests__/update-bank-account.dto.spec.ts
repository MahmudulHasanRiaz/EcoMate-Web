import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateBankAccountDto } from '../update-bank-account.dto';

describe('UpdateBankAccountDto — G-16 verification workflow validation', () => {
  it('rejects an unknown verificationStatus enum value', async () => {
    const dto = plainToInstance(UpdateBankAccountDto, {
      verificationStatus: 'UNKNOWN',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('verificationStatus');
  });

  it('accepts a valid verificationStatus together with a note', async () => {
    const dto = plainToInstance(UpdateBankAccountDto, {
      verificationStatus: 'VERIFIED',
      verificationNote: 'Bank statement checked against employee record',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a REJECTED status with no note', async () => {
    const dto = plainToInstance(UpdateBankAccountDto, {
      verificationStatus: 'REJECTED',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
