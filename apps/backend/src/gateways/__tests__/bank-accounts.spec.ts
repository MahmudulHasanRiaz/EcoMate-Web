import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { GatewayConfigController } from '../gateway-config.controller';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from '../dto/bank-account.dto';

const proto: any = GatewayConfigController.prototype;

function makeController(prisma: any) {
  return new GatewayConfigController(prisma);
}

const bankGateway = { id: 'gw-bank', code: 'bank' };

const accountRow = {
  id: 'ba-1',
  gatewayId: 'gw-bank',
  bankName: 'Dutch-Bangla Bank',
  accountHolderName: 'EcoMate Ltd',
  accountNumber: '1234567890',
  branchName: 'Motijheel',
  routingNumber: '090123456',
  accountType: 'SAVINGS',
  isActive: true,
  sortOrder: 0,
};

describe('Bank (manual) gateway accounts', () => {
  it('guards every bank-account endpoint with the gateway permissions + feature', () => {
    const expectations: Array<[string, string]> = [
      ['findAllBankAccounts', 'view_gateways'],
      ['createBankAccount', 'edit_gateways'],
      ['updateBankAccount', 'edit_gateways'],
      ['deleteBankAccount', 'edit_gateways'],
    ];
    for (const [method, perm] of expectations) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[method])).toEqual([
        perm,
      ]);
      expect(
        Reflect.getMetadata(REQUIRES_FEATURE_KEY, proto[method]),
      ).toBe('admin_payments');
    }
  });

  it('seeds the Bank (manual) gateway like the other manual gateways', () => {
    const src = GatewayConfigController.prototype.ensureStandardGateways.toString();
    expect(src).toMatch(/code: 'bank'/);
    expect(src).toMatch(/name: 'Bank \(Manual\)'/);
    expect(src).toMatch(/type: 'manual'/);
  });

  it('exposes bank accounts on the public list (active only) without credentials', () => {
    const src = GatewayConfigController.prototype.findAll.toString();
    expect(src).toMatch(/bankAccounts/);
    expect(src).toMatch(/isActive: true/);
    // The public mapper must never leak credential values.
    expect(src).not.toMatch(/credentials/);
  });

  it('lists accounts mapped to the public shape', async () => {
    const prisma = {
      paymentGateway: { findUnique: jest.fn().mockResolvedValue(bankGateway) },
      bankAccount: { findMany: jest.fn().mockResolvedValue([accountRow]) },
    };
    const ctrl = makeController(prisma);
    const rows = await ctrl.findAllBankAccounts();
    expect(prisma.bankAccount.findMany).toHaveBeenCalledWith({
      where: { gatewayId: 'gw-bank' },
      orderBy: { sortOrder: 'asc' },
    });
    expect(rows).toEqual([
      {
        id: 'ba-1',
        bankName: 'Dutch-Bangla Bank',
        accountHolderName: 'EcoMate Ltd',
        accountNumber: '1234567890',
        branchName: 'Motijheel',
        routingNumber: '090123456',
        accountType: 'SAVINGS',
        isActive: true,
        sortOrder: 0,
      },
    ]);
  });

  it('creates an account under the bank gateway with DTO defaults', async () => {
    const prisma = {
      paymentGateway: { findUnique: jest.fn().mockResolvedValue(bankGateway) },
      bankAccount: { create: jest.fn().mockResolvedValue(accountRow) },
    };
    const ctrl = makeController(prisma);
    const dto = new CreateBankAccountDto();
    Object.assign(dto, {
      bankName: 'Dutch-Bangla Bank',
      accountHolderName: 'EcoMate Ltd',
      accountNumber: '1234567890',
      branchName: 'Motijheel',
      routingNumber: '090123456',
      accountType: 'SAVINGS',
    });
    await ctrl.createBankAccount(dto);
    expect(prisma.bankAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gatewayId: 'gw-bank',
        bankName: 'Dutch-Bangla Bank',
        accountType: 'SAVINGS',
        isActive: true,
        sortOrder: 0,
      }),
    });
  });

  it('404s when updating an account that belongs to another gateway', async () => {
    const prisma = {
      paymentGateway: { findUnique: jest.fn().mockResolvedValue(bankGateway) },
      bankAccount: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const ctrl = makeController(prisma);
    const dto = new UpdateBankAccountDto();
    Object.assign(dto, { bankName: 'Other Bank' });
    await expect(ctrl.updateBankAccount('ba-x', dto)).rejects.toThrow(
      'Bank account "ba-x" not found',
    );
    expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'ba-x', gatewayId: 'gw-bank' },
    });
  });

  it('deletes an account scoped to the bank gateway', async () => {
    const prisma = {
      paymentGateway: { findUnique: jest.fn().mockResolvedValue(bankGateway) },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue(accountRow),
        delete: jest.fn().mockResolvedValue(accountRow),
      },
    };
    const ctrl = makeController(prisma);
    await expect(ctrl.deleteBankAccount('ba-1')).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.bankAccount.delete).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
    });
  });

  it('rejects a bank account DTO missing required NPSB fields', async () => {
    const dto = new CreateBankAccountDto();
    Object.assign(dto, {
      bankName: 'Dutch-Bangla Bank',
      accountNumber: '1234567890',
    });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property);
    expect(props).toEqual(
      expect.arrayContaining([
        'accountHolderName',
        'branchName',
        'routingNumber',
        'accountType',
      ]),
    );
  });

  it('rejects OTHERS: the shared enum carries it for employee accounts, merchant receiving accounts are SAVINGS/CURRENT only', async () => {
    const dto = new CreateBankAccountDto();
    Object.assign(dto, {
      bankName: 'Dutch-Bangla Bank',
      accountHolderName: 'EcoMate Ltd',
      accountNumber: '1234567890',
      branchName: 'Motijheel',
      routingNumber: '090123456',
      accountType: 'OTHERS',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('accountType');
  });

  it('rejects an unknown account type', async () => {
    const dto = new CreateBankAccountDto();
    Object.assign(dto, {
      bankName: 'Dutch-Bangla Bank',
      accountHolderName: 'EcoMate Ltd',
      accountNumber: '1234567890',
      branchName: 'Motijheel',
      routingNumber: '090123456',
      accountType: 'FIXED_DEPOSIT',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('accountType');
  });
});
