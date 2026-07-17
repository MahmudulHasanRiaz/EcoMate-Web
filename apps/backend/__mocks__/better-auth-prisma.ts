import { PrismaClient } from '@prisma/client';

const mockBetterAuthUser = {
  create: jest.fn().mockResolvedValue({ id: 'mock-ba-id', email: 'test@example.com' }),
  findUnique: jest.fn().mockResolvedValue(null),
  findFirst: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  findMany: jest.fn().mockResolvedValue([]),
};

const mockAccount = {
  create: jest.fn().mockResolvedValue({ id: 'mock-account-id' }),
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue({}),
};

const mockSession = {
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue({}),
  create: jest.fn().mockResolvedValue({}),
};

export const baPrisma = {
  betterAuthUser: mockBetterAuthUser,
  betterAuthAccount: mockAccount,
  account: mockAccount,
  session: mockSession,
  $transaction: jest.fn((cb: any) => cb(baPrisma)),
} as unknown as PrismaClient;
