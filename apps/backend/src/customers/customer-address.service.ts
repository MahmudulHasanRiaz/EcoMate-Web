/**
 * Customer-owned address book.
 *
 * OWNERSHIP: this service owns CustomerAddress rows and nothing else. It never
 * writes Order.shippingAddress or Order.billingAddress — those are order-owned
 * historical snapshots. Editing a customer address must never alter a
 * historical order, and placing an order must never delete an address.
 *
 * DEDUP: a new order's address is matched by fingerprint WITHIN its role. A
 * match reuses the existing row; anything else becomes a new row. The book only
 * ever grows — a new order can never replace or remove an existing address.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import {
  addressFingerprint,
  readAddressBlob,
  type AddressInput,
} from './customer-address.util';

export type CustomerAddressType = 'SHIPPING' | 'BILLING';

export interface SyncFromOrderInput {
  customerProfileId: string | null | undefined;
  shippingAddress: unknown;
  billingAddress: unknown;
  orderId: string;
}

@Injectable()
export class CustomerAddressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrich the address book from an order. Safe to call for every order.
   *
   * First order seeds both roles when no separate billing address was captured
   * (shipping == billing is a legitimate and common case). That seeds two ROLE
   * records with identical contents — intentional, not a duplicate. See the
   * CustomerAddress model comment.
   */
  async syncFromOrder(tx: Prisma.TransactionClient, input: SyncFromOrderInput): Promise<number> {
    const { customerProfileId } = input;
    if (!customerProfileId) return 0;

    const shipping = readAddressBlob(input.shippingAddress);
    const billing = readAddressBlob(input.billingAddress);

    const candidates: { type: CustomerAddressType; addr: AddressInput }[] = [];
    if (shipping) candidates.push({ type: 'SHIPPING', addr: shipping });
    if (billing) {
      candidates.push({ type: 'BILLING', addr: billing });
    } else if (shipping) {
      // No billing captured: seed the BILLING role from the shipping address.
      // This is address-book initialisation for a reusable customer record —
      // NOT a write to the order's billing snapshot, which stays empty.
      candidates.push({ type: 'BILLING', addr: shipping });
    }

    let created = 0;
    for (const { type, addr } of candidates) {
      const hash = addressFingerprint(addr);
      const existing = await tx.customerAddress.findFirst({
        where: { customerProfileId, type, normalizedHash: hash },
        select: { id: true, isDefault: true },
      });
      if (existing) {
        // Reuse. Never overwrite the stored address fields — a repeat order to
        // a known address must not mutate the record the customer already has.
        continue;
      }

      const isFirstForType = await tx.customerAddress.count({ where: { customerProfileId, type } });
      await tx.customerAddress.create({
        data: {
          customerProfileId,
          type,
          normalizedHash: hash,
          isDefault: isFirstForType === 0,
          fullName: addr.fullName ?? '',
          phone: addr.phone ?? '',
          addressLine: addr.addressLine ?? '',
          area: addr.area || null,
          thana: addr.thana || null,
          district: addr.district || null,
          division: addr.division || null,
          postalCode: addr.postalCode || null,
          country: addr.country || 'Bangladesh',
          sourceOrderId: input.orderId,
        },
      });
      created += 1;
    }
    return created;
  }

  /** Full address book, shipping first, default first within each role. */
  async list(customerProfileId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerProfileId },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Single default per (customer, role), enforced transactionally. */
  async setDefault(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.customerAddress.findUnique({
        where: { id },
        select: { customerProfileId: true, type: true },
      });
      if (!row) return null;
      await tx.customerAddress.updateMany({
        where: { customerProfileId: row.customerProfileId, type: row.type },
        data: { isDefault: false },
      });
      return tx.customerAddress.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }

  /**
   * Explicit profile edit of an address row. Only supplied fields are written,
   * and changing the content re-derives the fingerprint so a later order to the
   * edited address is correctly recognised as new.
   */
  async update(id: string, patch: Partial<AddressInput> & { label?: string | null }) {
    const current = await this.prisma.customerAddress.findUnique({ where: { id } });
    if (!current) return null;

    const merged: AddressInput = {
      fullName: patch.fullName ?? current.fullName,
      phone: patch.phone ?? current.phone,
      addressLine: patch.addressLine ?? current.addressLine,
      area: patch.area ?? current.area,
      thana: patch.thana ?? current.thana,
      district: patch.district ?? current.district,
      division: patch.division ?? current.division,
      postalCode: patch.postalCode ?? current.postalCode,
      country: patch.country ?? current.country,
    };

    return this.prisma.customerAddress.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        fullName: merged.fullName ?? '',
        phone: merged.phone ?? '',
        addressLine: merged.addressLine ?? '',
        area: merged.area || null,
        thana: merged.thana || null,
        district: merged.district || null,
        division: merged.division || null,
        postalCode: merged.postalCode || null,
        country: merged.country || 'Bangladesh',
        normalizedHash: addressFingerprint(merged),
      },
    });
  }

  async remove(id: string) {
    return this.prisma.customerAddress.delete({ where: { id } });
  }
}
