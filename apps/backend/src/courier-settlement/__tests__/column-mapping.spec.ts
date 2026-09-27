// §12 column mapping safety rules (frozen):
//  · a mapping is a CANDIDATE until "always use" is explicit;
//  · two active columns can never claim the same field (409, fail-closed);
//  · an unsupported courier or a field with no slot is rejected loudly;
//  · activation/deactivation is audited against the invoice it came from.

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementActivityService } from '../activity.service';
import { CourierSettlementMappingService, MAPPABLE_FIELDS } from '../column-mapping.service';

function makePrisma(aliases: any[] = []) {
  const store = [...aliases];
  const prisma: any = {
    courierSettlementColumnAlias: {
      findMany: async ({ where }: any) =>
        store.filter(
          (a) =>
            (!where?.courier || a.courier === where.courier) &&
            (where?.field === undefined || a.field === where.field) &&
            (where?.active === undefined || a.active === where.active),
        ),
      findUnique: async ({ where }: any) =>
        where.id
          ? store.find((a) => a.id === where.id) ?? null
          : store.find(
              (a) =>
                a.courier === where.courier_sourceHeader.courier &&
                a.sourceHeader === where.courier_sourceHeader.sourceHeader,
            ) ?? null,
      findFirst: async ({ where }: any) =>
        store.find(
          (a) =>
            a.courier === where.courier &&
            a.field === where.field &&
            a.active === where.active &&
            a.sourceHeader !== where.sourceHeader.not,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `map-${store.length + 1}`, ambiguityCount: 0, ...data };
        store.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = store.find((a) => a.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { prisma, store };
}

async function makeService(aliases: any[] = []) {
  const db = makePrisma(aliases);
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementMappingService,
      { provide: PrismaService, useValue: db.prisma },
      { provide: CourierSettlementActivityService, useValue: activity },
    ],
  }).compile();
  return { svc: mod.get(CourierSettlementMappingService), db, activity };
}

describe('CourierSettlementMappingService (§12)', () => {
  it('stores a proposed mapping as an inactive candidate', async () => {
    const { svc, db } = await makeService();
    const created = await svc.propose(
      { courier: 'pathao', sourceHeader: 'My_ID_Column', field: 'consignmentId' },
      'u1',
    );

    expect(created.active).toBe(false);
    expect(created.confidence).toBeLessThan(1);
    expect(db.store[0].active).toBe(false);
  });

  it('activates immediately only when "always use" is explicit', async () => {
    const { svc } = await makeService();
    const created = await svc.propose(
      { courier: 'pathao', sourceHeader: 'My_ID_Column', field: 'consignmentId', alwaysUse: true },
      'u1',
    );
    expect(created.active).toBe(true);
    expect(created.confidence).toBe(1);
  });

  it('refuses two active columns claiming the same field', async () => {
    const { svc } = await makeService([
      {
        id: 'existing',
        courier: 'pathao',
        sourceHeader: 'Consignment_ID',
        normalizedHeader: 'consignment_id',
        field: 'consignmentId',
        active: true,
        confidence: 1,
        origin: 'MANUAL',
        ambiguityCount: 0,
        createdBy: null,
      },
    ]);

    await expect(
      svc.propose(
        { courier: 'pathao', sourceHeader: 'Other_ID', field: 'consignmentId', alwaysUse: true },
        'u1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // …and without "always use" it must land as an inactive candidate, never active.
    const candidate = await svc.propose(
      { courier: 'pathao', sourceHeader: 'Other_ID', field: 'consignmentId' },
      'u1',
    );
    expect(candidate.active).toBe(false);
  });

  it('activate() blocks when a rival already claims the field', async () => {
    const { svc } = await makeService([
      {
        id: 'a',
        courier: 'pathao',
        sourceHeader: 'A',
        normalizedHeader: 'a',
        field: 'net',
        active: false,
        confidence: 0.6,
        origin: 'MANUAL',
        ambiguityCount: 0,
        createdBy: null,
      },
      {
        id: 'b',
        courier: 'pathao',
        sourceHeader: 'B',
        normalizedHeader: 'b',
        field: 'net',
        active: true,
        confidence: 1,
        origin: 'MANUAL',
        ambiguityCount: 0,
        createdBy: null,
      },
    ]);

    await expect(svc.activate('a', {}, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deactivates and audibly records the change on the invoice', async () => {
    const { svc, activity, db } = await makeService([
      {
        id: 'a',
        courier: 'pathao',
        sourceHeader: 'A',
        normalizedHeader: 'a',
        field: 'net',
        active: true,
        confidence: 1,
        origin: 'MANUAL',
        ambiguityCount: 0,
        createdBy: null,
      },
    ]);

    const res = await svc.deactivate('a', { reason: 'wrong column', invoiceId: 'inv-1' }, 'u1');
    expect(res.active).toBe(false);
    expect(db.store[0].active).toBe(false);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', action: 'MAPPED' }),
    );
  });

  it('rejects an unsupported courier and a field with no slot', async () => {
    const { svc } = await makeService();
    await expect(
      svc.propose({ courier: 'paperfly', sourceHeader: 'X', field: 'net' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.propose({ courier: 'pathao', sourceHeader: 'X', field: 'nope' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('raises NotFound for an unknown mapping', async () => {
    const { svc } = await makeService();
    await expect(svc.activate('missing', {}, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exposes every mappable field with a label for the UI', async () => {
    const { svc } = await makeService();
    const res = await svc.list();
    expect(res.fields.map((f) => f.field)).toEqual([...MAPPABLE_FIELDS]);
    expect(res.total).toBe(0);
  });
});
