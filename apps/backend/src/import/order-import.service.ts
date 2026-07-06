import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { randomUUID } from 'node:crypto';
import * as Papa from 'papaparse';
import type {
  OrderImportRow,
  ParsedOrderItem,
  OrderImportSummary,
  OrderImportError,
} from './types/order-import.types';

const STATUS_MAP: Record<string, string> = {
  completed: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Returned',
  processing: 'Confirmed',
  'in-courier': 'Shipping',
  'on-hold': 'Hold',
  pending: 'Pending',
  failed: 'Cancelled',
  trash: 'Cancelled',
  'pending-payment': 'Pending',
};

const BATCH_SIZE = 50;

interface RawOrderRow {
  [key: string]: string | undefined;
}

@Injectable()
export class OrderImportService {
  private readonly logger = new Logger(OrderImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
  ) {}

  async importFromCsv(
    csvContent: string,
    opts: { onProgress?: (processed: number) => void } = {},
  ): Promise<{
    summary: OrderImportSummary;
    errors: OrderImportError[];
  }> {
    const parsed = Papa.parse<RawOrderRow>(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    const criticalErrors = parsed.errors.filter(
      (e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields',
    );
    if (criticalErrors.length > 0) {
      throw new BadRequestException(
        `CSV parse error: ${criticalErrors[0].message}`,
      );
    }

    const nonCriticalErrors = parsed.errors.filter(
      (e) => e.code === 'TooFewFields' || e.code === 'TooManyFields',
    );
    for (const e of nonCriticalErrors) {
      this.logger.warn(`CSV non-critical warning (row ${e.row}): ${e.message}`);
    }

    const summary: OrderImportSummary = {
      ordersImported: 0,
      ordersSkipped: 0,
      customersCreated: 0,
      customersFound: 0,
      errors: 0,
    };

    const allErrors: OrderImportError[] = [];
    const rawRows = parsed.data.filter((r) => r.order_id?.trim());
    const skippedCount = parsed.data.length - rawRows.length;
    if (skippedCount > 0) {
      this.logger.warn(`Skipped ${skippedCount} row(s) without order_id`);
    }
    this.logger.log(`Parsed ${rawRows.length} order row(s) from CSV`);

    const rows: OrderImportRow[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      try {
        const row = this.parseRow(rawRows[i], i + 2);
        rows.push(row);
      } catch (err) {
        allErrors.push({
          rowNumber: i + 2,
          orderId: rawRows[i].order_id || '?',
          errorType: 'PARSE_ERROR',
          message: (err as Error).message,
        });
        summary.errors++;
      }
    }

    const statusCache = await this.ensureStatuses();

    let processedCount = 0;
    // Process orders sequentially in batches to preserve order sequence and prevent race conditions
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const { variantSkuMap, productSkuMap, productNameMap, customerPhoneMap } =
        await this.preloadBatchEntities(batch);

      await this.processBatch(
        batch,
        statusCache,
        variantSkuMap,
        productSkuMap,
        productNameMap,
        customerPhoneMap,
        summary,
        allErrors,
      );

      processedCount += batch.length;
      if (opts.onProgress) {
        opts.onProgress(processedCount);
      }

      // Yield to the event loop between batches
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return { summary, errors: allErrors };
  }

  private async preloadBatchEntities(batch: OrderImportRow[]) {
    const itemSkus = new Set<string>();
    const itemNames = new Set<string>();

    for (const row of batch) {
      for (const item of row.items) {
        if (item.sku) {
          itemSkus.add(item.sku.trim().toLowerCase());
        }
        if (item.name) {
          itemNames.add(item.name.trim().toLowerCase());
        }
      }
    }

    const phones = new Set<string>();
    for (const row of batch) {
      if (row.billingPhone) {
        let normalized = normalizePhone(row.billingPhone);
        if (!normalized) {
          const cleaned = row.billingPhone.replace(/[^\d+]/g, '');
          if (cleaned.length >= 7 && cleaned.length <= 15) {
            normalized = cleaned.startsWith('+') ? cleaned : '+' + cleaned;
          }
        }
        if (normalized) {
          phones.add(normalized);
        }
        phones.add(row.billingPhone.trim());
      }
    }

    const skuList = Array.from(itemSkus);
    const nameList = Array.from(itemNames);
    const phoneList = Array.from(phones);

    const [dbProducts, dbVariants, dbCustomers] = await Promise.all([
      skuList.length > 0 || nameList.length > 0
        ? this.prisma.product.findMany({
            where: {
              OR: [
                skuList.length > 0
                  ? { sku: { in: skuList, mode: 'insensitive' } }
                  : {},
                nameList.length > 0
                  ? { name: { in: nameList, mode: 'insensitive' } }
                  : {},
              ].filter((cond) => Object.keys(cond).length > 0) as any,
            },
            select: { id: true, name: true, sku: true },
          })
        : [],
      skuList.length > 0
        ? this.prisma.productVariant.findMany({
            where: {
              sku: { in: skuList, mode: 'insensitive' },
            },
            select: { id: true, productId: true, sku: true },
          })
        : [],
      phoneList.length > 0
        ? this.prisma.userProfile.findMany({
            where: {
              role: 'customer',
              phoneNumber: { in: phoneList },
            },
            select: { id: true, phoneNumber: true },
          })
        : [],
    ]);

    const variantSkuMap = new Map<string, { id: string; productId: string }>();
    for (const v of dbVariants) {
      if (v.sku) {
        variantSkuMap.set(v.sku.trim().toLowerCase(), {
          id: v.id,
          productId: v.productId,
        });
      }
    }

    const productSkuMap = new Map<string, string>();
    const productNameMap = new Map<string, string>();
    for (const p of dbProducts) {
      if (p.sku) {
        productSkuMap.set(p.sku.trim().toLowerCase(), p.id);
      }
      productNameMap.set(p.name.trim().toLowerCase(), p.id);
    }

    const customerPhoneMap = new Map<string, string>();
    for (const c of dbCustomers) {
      if (c.phoneNumber) {
        customerPhoneMap.set(c.phoneNumber, c.id);
      }
    }

    return {
      variantSkuMap,
      productSkuMap,
      productNameMap,
      customerPhoneMap,
    };
  }

  private async processBatch(
    rows: OrderImportRow[],
    statusCache: Map<string, string>,
    variantSkuMap: Map<string, { id: string; productId: string }>,
    productSkuMap: Map<string, string>,
    productNameMap: Map<string, string>,
    customerPhoneMap: Map<string, string>,
    summary: OrderImportSummary,
    errors: OrderImportError[],
  ): Promise<void> {
    for (const row of rows) {
      try {
        await this.processOrder(
          row,
          statusCache,
          variantSkuMap,
          productSkuMap,
          productNameMap,
          customerPhoneMap,
          summary,
        );
      } catch (err) {
        errors.push({
          rowNumber: row.rowNumber,
          orderId: row.orderId,
          errorType: 'IMPORT_FAILED',
          message: (err as Error).message,
        });
        summary.errors++;
      }
    }
  }

  private async processOrder(
    row: OrderImportRow,
    statusCache: Map<string, string>,
    variantSkuMap: Map<string, { id: string; productId: string }>,
    productSkuMap: Map<string, string>,
    productNameMap: Map<string, string>,
    customerPhoneMap: Map<string, string>,
    summary: OrderImportSummary,
  ): Promise<void> {
    // 1. Idempotency Check & Deterministic Display ID
    const displayId = `WC-${row.orderNumber || row.orderId}`;
    const existingOrder = await this.prisma.order.findUnique({
      where: { displayId },
      select: { id: true },
    });

    if (existingOrder) {
      summary.ordersSkipped++;
      return;
    }

    const statusId =
      statusCache.get(row.status.toLowerCase()) || statusCache.get('Pending')!;

    // 2. Customer Lookup & Creation (using local memory caches)
    let customerId: string | null = null;
    const customerName =
      [row.billingFirstName, row.billingLastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      row.billingFirstName ||
      'Unknown';

    if (row.billingPhone) {
      let normalized = normalizePhone(row.billingPhone);
      if (!normalized) {
        const cleaned = row.billingPhone.replace(/[^\d+]/g, '');
        if (cleaned.length >= 7 && cleaned.length <= 15) {
          normalized = cleaned.startsWith('+') ? cleaned : '+' + cleaned;
        }
      }

      if (normalized) {
        if (customerPhoneMap.has(normalized)) {
          customerId = customerPhoneMap.get(normalized)!;
          summary.customersFound++;
        } else {
          const customer = await this.customersService.findOrCreateCustomer(
            row.billingPhone,
            customerName,
          );
          customerId = customer.id;
          customerPhoneMap.set(normalized, customer.id);
          summary.customersCreated++;
        }
      }
    }

    // 3. Payment Option Mapping
    let paymentOptionType: 'FULL_PAYMENT' | 'CASH_ON_DELIVERY' | null = null;
    let paymentStatus: string = 'PAYMENT_PENDING';

    if (
      row.paymentMethod === 'cod' ||
      row.paymentMethodTitle?.toLowerCase().includes('cash on delivery') ||
      row.paymentMethodTitle?.toLowerCase().includes('cod')
    ) {
      paymentOptionType = 'CASH_ON_DELIVERY';
      paymentStatus = row.status === 'completed' ? 'PAID' : 'UNPAID';
    } else {
      paymentOptionType = 'FULL_PAYMENT';
      paymentStatus = row.status === 'completed' ? 'PAID' : 'PAYMENT_PENDING';
    }

    if (row.status === 'cancelled') {
      paymentStatus = 'CANCELLED';
    }

    // 4. Addresses mapping
    const shippingAddress: Record<string, string> = {};
    if (row.shippingAddress1) shippingAddress.address1 = row.shippingAddress1;
    if (row.shippingAddress2) shippingAddress.address2 = row.shippingAddress2;
    if (row.shippingCity) shippingAddress.city = row.shippingCity;
    if (row.shippingState) shippingAddress.state = row.shippingState;
    if (row.shippingPostcode) shippingAddress.postcode = row.shippingPostcode;
    if (row.shippingCountry) shippingAddress.country = row.shippingCountry;
    if (row.shippingFirstName)
      shippingAddress.firstName = row.shippingFirstName;
    if (row.shippingLastName) shippingAddress.lastName = row.shippingLastName;
    if (row.shippingPhone) shippingAddress.phone = row.shippingPhone;

    const billingAddress: Record<string, string> = {};
    if (row.billingAddress1) billingAddress.address1 = row.billingAddress1;
    if (row.billingAddress2) billingAddress.address2 = row.billingAddress2;
    if (row.billingCity) billingAddress.city = row.billingCity;
    if (row.billingState) billingAddress.state = row.billingState;
    if (row.billingPostcode) billingAddress.postcode = row.billingPostcode;
    if (row.billingCountry) billingAddress.country = row.billingCountry;

    let orderDate: Date;
    try {
      orderDate = new Date(row.orderDate);
      if (isNaN(orderDate.getTime())) orderDate = new Date();
    } catch {
      orderDate = new Date();
    }

    // 5. Timeline construction (parsing WooCommerce historical notes)
    const notes = this.parseOrderNotes(row.orderNotes);
    const timeline = [
      {
        status: row.status.toUpperCase(),
        timestamp: orderDate.toISOString(),
        note: `Imported from WooCommerce (Order #${row.orderId})`,
        type: 'import',
      },
      ...notes,
    ];
    timeline.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // 6. Fee & Discount corrections
    let discountTotal = Math.abs(row.discountTotal);
    if (row.feeTotal < 0) {
      discountTotal += Math.abs(row.feeTotal);
    }

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          displayId,
          customerId,
          statusId,
          subtotal: row.orderSubtotal,
          shippingCharge: row.shippingTotal,
          discount: discountTotal,
          discountType: 'flat',
          total: row.orderTotal,
          shippingAddress: {
            shipping: shippingAddress,
            billing: billingAddress,
          } as any,
          customerNotes: row.customerNote || null,
          guestName: customerId ? null : customerName,
          guestPhone: customerId ? null : row.billingPhone || null,
          paymentOptionType: paymentOptionType as any,
          paymentStatus: paymentStatus as any,
          viewToken: randomUUID(),
          timeline: timeline as any,
          createdAt: orderDate,
        },
      });

      if (row.items.length > 0) {
        await tx.orderItem.createMany({
          data: row.items.map((item) => {
            const skuLower = item.sku?.trim().toLowerCase();
            const nameLower = item.name?.trim().toLowerCase();

            let productId: string | null = null;
            let variantId: string | null = null;

            if (skuLower && variantSkuMap.has(skuLower)) {
              const match = variantSkuMap.get(skuLower)!;
              productId = match.productId;
              variantId = match.id;
            } else if (skuLower && productSkuMap.has(skuLower)) {
              productId = productSkuMap.get(skuLower)!;
            } else if (nameLower && productNameMap.has(nameLower)) {
              productId = productNameMap.get(nameLower)!;
            }

            return {
              orderId: order.id,
              productId,
              variantId,
              quantity: item.quantity,
              price: item.price,
            };
          }),
        });
      }
    });

    summary.ordersImported++;
  }

  private parseRow(data: RawOrderRow, rowNumber: number): OrderImportRow {
    const items = this.parseLineItems(data);

    return {
      rowNumber,
      orderId: (data.order_id || '').trim(),
      orderNumber: (data.order_number || data.order_id || '').trim(),
      orderDate: (data.order_date || '').trim(),
      paidDate: (data.paid_date || '').trim(),
      status: (data.status || 'pending').trim().toLowerCase(),
      shippingTotal: this.parseFloat(data.shipping_total),
      discountTotal: this.parseFloat(data.discount_total),
      feeTotal: this.parseFloat(data.fee_total),
      orderTotal: this.parseFloat(data.order_total),
      orderSubtotal: this.parseFloat(data.order_subtotal),
      orderCurrency: (data.order_currency || 'BDT').trim(),
      paymentMethod: (data.payment_method || '').trim(),
      paymentMethodTitle: (data.payment_method_title || '').trim(),
      transactionId: (data.transaction_id || '').trim(),
      customerNote: (data.customer_note || data.customerNote || '').trim(),
      orderNotes: (data.order_notes || '').trim(),
      billingFirstName: (data.billing_first_name || '').trim(),
      billingLastName: (data.billing_last_name || '').trim(),
      billingCompany: (data.billing_company || '').trim(),
      billingEmail: (data.billing_email || '').trim(),
      billingPhone: (data.billing_phone || '').trim(),
      billingAddress1: (data.billing_address_1 || '').trim(),
      billingAddress2: (data.billing_address_2 || '').trim(),
      billingPostcode: (data.billing_postcode || '').trim(),
      billingCity: (data.billing_city || '').trim(),
      billingState: (data.billing_state || '').trim(),
      billingCountry: (data.billing_country || '').trim(),
      shippingFirstName: (data.shipping_first_name || '').trim(),
      shippingLastName: (data.shipping_last_name || '').trim(),
      shippingCompany: (data.shipping_company || '').trim(),
      shippingPhone: (data.shipping_phone || '').trim(),
      shippingAddress1: (data.shipping_address_1 || '').trim(),
      shippingAddress2: (data.shipping_address_2 || '').trim(),
      shippingPostcode: (data.shipping_postcode || '').trim(),
      shippingCity: (data.shipping_city || '').trim(),
      shippingState: (data.shipping_state || '').trim(),
      shippingCountry: (data.shipping_country || '').trim(),
      items,
    };
  }

  private parseLineItems(data: RawOrderRow): ParsedOrderItem[] {
    const items: ParsedOrderItem[] = [];

    for (let i = 1; i <= 20; i++) {
      const lineItemCol = `line_item_${i}`;
      const lineItemRaw = data[lineItemCol];
      if (lineItemRaw && lineItemRaw.trim()) {
        const parsed = this.parseLineItemField(lineItemRaw.trim());
        if (parsed) {
          items.push(parsed);
          continue;
        }
      }

      const nameCol = `Product Item ${i} Name`;
      const skuCol = `Product Item ${i} SKU`;
      const qtyCol = `Product Item ${i} Quantity`;
      const totalCol = `Product Item ${i} Total`;
      const subtotalCol = `Product Item ${i} Subtotal`;
      const idCol = `Product Item ${i} id`;

      const name = data[nameCol]?.trim();
      if (!name) break;

      items.push({
        name,
        sku: (data[skuCol] || '').trim(),
        productId: (data[idCol] || '').trim(),
        quantity: this.parseInt(data[qtyCol], 1),
        price:
          this.parseFloatSafe(data[totalCol]) /
          Math.max(1, this.parseInt(data[qtyCol], 1)),
        total: this.parseFloatSafe(data[totalCol]),
        subtotal: this.parseFloatSafe(data[subtotalCol]),
        variationId: '',
      });
    }

    return items;
  }

  private parseLineItemField(raw: string): ParsedOrderItem | null {
    const parts = raw.split('|');
    const map = new Map<string, string>();

    for (const part of parts) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const key = part.slice(0, idx);
      const value = part.slice(idx + 1);
      if (!map.has(key)) {
        map.set(key, value);
      }
    }

    const name = map.get('name') || '';
    if (!name) return null;

    return {
      name,
      sku: map.get('sku') || '',
      productId: map.get('product_id') || '',
      quantity: parseInt(map.get('quantity') || '1') || 1,
      total: parseFloat(map.get('total') || '0') || 0,
      subtotal: parseFloat(map.get('sub_total') || '0') || 0,
      price:
        (parseFloat(map.get('total') || '0') || 0) /
        Math.max(1, parseInt(map.get('quantity') || '1') || 1),
      variationId: map.get('_variation_id') || '',
    };
  }

  private parseOrderNotes(rawNotes: string | undefined): any[] {
    if (!rawNotes || !rawNotes.trim()) return [];

    const notes: any[] = [];
    const blocks = rawNotes.split('||');

    for (const block of blocks) {
      if (!block.trim()) continue;

      const parts = block.split('|');
      const map = new Map<string, string>();
      for (const part of parts) {
        const idx = part.indexOf(':');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        map.set(key, value);
      }

      const content = map.get('content') || '';
      if (!content) continue;

      const dateStr = map.get('date');
      const addedBy = map.get('added_by') || 'system';

      let timestamp = new Date().toISOString();
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          timestamp = d.toISOString();
        }
      }

      notes.push({
        status: 'Note',
        timestamp,
        note: content,
        type: addedBy === 'system' ? 'system' : 'staff',
        user: addedBy,
      });
    }

    return notes;
  }

  private async ensureStatuses(): Promise<Map<string, string>> {
    const existing = await this.prisma.orderStatus.findMany({
      select: { id: true, name: true },
    });
    const nameToId = new Map(existing.map((s) => [s.name, s.id]));

    for (const wcStatus of Object.keys(STATUS_MAP)) {
      const localName = STATUS_MAP[wcStatus];
      if (!nameToId.has(localName)) {
        const created = await this.prisma.orderStatus.create({
          data: {
            name: localName,
            color: this.getStatusColor(localName),
            sortOrder: 0,
            nextStatuses: [],
          },
        });
        nameToId.set(localName, created.id);
        this.logger.log(`Created missing status: ${localName}`);
      }
    }

    const result = new Map<string, string>();
    for (const [wcStatus, localName] of Object.entries(STATUS_MAP)) {
      const id = nameToId.get(localName);
      if (id) {
        result.set(wcStatus, id);
      }
    }
    result.set('Pending', nameToId.get('Pending')!);
    result.set('Delivered', nameToId.get('Delivered')!);
    result.set('Cancelled', nameToId.get('Cancelled')!);

    return result;
  }

  private getStatusColor(name: string): string {
    const colors: Record<string, string> = {
      Pending: '#F59E0B',
      Hold: '#F97316',
      Confirmed: '#3B82F6',
      Packed: '#059669',
      'Packing Hold': '#D97706',
      Shipping: '#06B6D4',
      Delivered: '#16A34A',
      Partial: '#8B5CF6',
      'Return Pending': '#EC4899',
      Returned: '#F43F5E',
      Damaged: '#991B1B',
      Cancelled: '#DC2626',
    };
    return colors[name] || '#6B7280';
  }

  private parseFloat(val: string | undefined): number {
    if (!val || val.trim() === '') return 0;
    const cleaned = val.trim().replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  private parseFloatSafe(val: string | undefined): number {
    return this.parseFloat(val);
  }

  private parseInt(val: string | undefined, defaultVal: number = 0): number {
    if (!val || val.trim() === '') return defaultVal;
    const cleaned = val.trim().replace(/[^0-9-]/g, '');
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? defaultVal : n;
  }
}
