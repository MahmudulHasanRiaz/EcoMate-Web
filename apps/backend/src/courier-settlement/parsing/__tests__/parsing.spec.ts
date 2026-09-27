// ── Parsing layer tests (P2). All amounts are proven against the real, anonymised
// fixtures in __fixtures__/. PII names/phones are masked in committed fixtures;
// Bengali double-encoding is reproduced synthetically to test repair (§13).

import * as fs from 'fs';
import * as path from 'path';
import { parseInvoiceFile, FileTypeUnsupportedError } from '../invoice-parser.service';
import { repairDoubleEncoding } from '../helpers';

const FIX = path.join(__dirname, '..', '__fixtures__');

function load(name: string): Buffer {
  return fs.readFileSync(path.join(FIX, name));
}

function netOf(inv: Awaited<ReturnType<typeof parseInvoiceFile>>, consignment: string): number {
  return inv.rows.find((r) => r.consignmentId === consignment)!.net;
}
function chargesOf(inv: Awaited<ReturnType<typeof parseInvoiceFile>>, consignment: string): number {
  return inv.rows.find((r) => r.consignmentId === consignment)!.charges;
}

describe('courier settlement — parsing (P2)', () => {
  describe('Pathao — declared_payout (proven)', () => {
    let inv: Awaited<ReturnType<typeof parseInvoiceFile>>;
    beforeAll(async () => {
      inv = await parseInvoiceFile({ buffer: load('pathao.csv'), filename: 'pathao paid_invoice_2026-09-27.csv' });
    });

    it('detects pathao and proves finance', () => {
      expect(inv.meta.provider).toBe('pathao');
      expect(inv.meta.proven).toBe(true);
      expect(inv.meta.isStructureOnly).toBe(false);
      expect(inv.meta.rowCount).toBe(4);
      expect(inv.meta.invoiceDate).toEqual(new Date('2026-09-27'));
    });

    it('proves Payout = Collected_Amount − Final_Fee (row 770/55/715)', () => {
      const r = inv.rows.find((x) => x.displayId === 'ORD-260925-0020')!;
      expect(r.rowClass).toBe('DATA');
      expect(r.rowKind).toBe('DELIVERY');
      expect(r.collected).toBe(770);
      expect(r.charges).toBe(55);
      expect(r.net).toBe(715);
      expect(r.anomaly.residual).toBeCloseTo(0, 2);
      expect(r.anomaly.arithmeticOk).toBe(true);
      expect(r.anomaly.proven).toBe(true);
    });

    it('proves insta_fee negative-payout row (0 collected, 26.84 charges, -26.84 net)', () => {
      const r = inv.rows.find((x) => x.displayId === 'ORD-260924-0019' && x.rowKind === 'FEE_ONLY')!;
      expect(r.collected).toBe(0);
      expect(r.charges).toBeCloseTo(26.84, 2);
      expect(r.net).toBeCloseTo(-26.84, 2);
      expect(r.anomaly.residual).toBeCloseTo(0, 2);
    });

    it('component sum reconciles to Final_Fee (arithmetic invariant)', () => {
      const r = inv.rows.find((x) => x.displayId === 'ORD-260925-0017')!;
      const sum = r.chargeComponents.reduce((a, c) => a + c.sign * c.value, 0);
      expect(sum).toBeCloseTo(r.charges, 2);
      expect(r.anomaly.arithmeticDelta).toBeCloseTo(0, 2);
    });

    it('surfaces duplicate consignment_id across non-adjacent rows', () => {
      const dupes = inv.rows.filter((r) => r.consignmentId === 'DF2409266X3XVL');
      expect(dupes.map((r) => r.rowNumber)).toEqual([1, 4]);
      expect(dupes.map((r) => r.displayId)).toEqual(['ORD-260924-0019', 'ORD-260924-0019']);
    });
  });

  describe('Steadfast — collected_minus_charges (proven)', () => {
    let inv: Awaited<ReturnType<typeof parseInvoiceFile>>;
    beforeAll(async () => {
      inv = await parseInvoiceFile({
        buffer: load('steadfast.xlsx'),
        filename: 'Steadfast 2026-09-27-payment-SFC-25442616.xlsx',
      });
    });

    it('detects steadfast and proves finance', () => {
      expect(inv.meta.provider).toBe('steadfast');
      expect(inv.meta.proven).toBe(true);
      expect(inv.meta.isStructureOnly).toBe(false);
    });

    it('proves net = COD − Shipping Charge − COD Charge (4780 = 5000 − 170 − 50)', () => {
      const r = inv.rows.find((x) => x.trackingCode === 'SFR250806PD10E9E3DBD')!;
      expect(r.rowClass).toBe('DATA');
      expect(r.rowKind).toBe('DELIVERY');
      expect(r.collected).toBe(5000);
      expect(r.charges).toBe(220); // 170 + 50
      expect(r.net).toBe(4780);
      expect(r.anomaly.residual).toBeCloseTo(0, 2);
      expect(r.anomaly.arithmeticOk).toBe(true);
    });

    it('records provider tracking + status', () => {
      const r = inv.rows.find((x) => x.trackingCode === 'SFR250806PD10E9E3DBD')!;
      expect(r.deliveryStatus).toBe('Delivered');
      expect(r.paymentStatus).toBe('Paid');
      expect(r.declared['Order ID']).toBe('163398958');
    });
  });

  describe('CarryBee — billing_when_no_collection (proven, all prepaid)', () => {
    let inv: Awaited<ReturnType<typeof parseInvoiceFile>>;
    beforeAll(async () => {
      inv = await parseInvoiceFile({
        buffer: load('carrybee.csv'),
        filename: 'carrybee invoice-I110526K3DJ5N.csv',
      });
    });

    it('detects carrybee and proves finance over all rows', () => {
      expect(inv.meta.provider).toBe('carrybee');
      expect(inv.meta.proven).toBe(true);
      expect(inv.meta.rowCount).toBe(34);
      expect(inv.meta.invoiceNo).toBe('I110526K3DJ5N');
    });

    it('every row is a prepaid billing-only row (Collected Amount = 0)', () => {
      expect(inv.rows.every((r) => r.collected === 0)).toBe(true);
      expect(inv.rows.every((r) => r.rowKind === 'BILLING_ONLY')).toBe(true);
      expect(inv.rows.every((r) => r.anomaly.proven)).toBe(true);
      expect(inv.rows.every((r) => Math.abs(r.anomaly.residual) <= 0.05)).toBe(true);
      expect(inv.rows.length).toBe(34);
    });

    it('net = −Billing_amount for proven rows (by consignment)', () => {
      expect(netOf(inv, 'F02267W32EL')).toBe(-100);
      expect(netOf(inv, 'F0311RW8PEG')).toBe(-49);
      expect(netOf(inv, 'F0327JELYD9')).toBe(-40);
      expect(netOf(inv, 'F03296TQ93W')).toBe(-40);
      // charges equal the billing amount (the only cost component)
      expect(chargesOf(inv, 'F0311RW8PEG')).toBe(49);
    });

    it('preserves an empty merchant_order_id without crashing', () => {
      const empty = inv.rows.find((r) => r.declared['merchant_order_id'] === '');
      expect(empty).toBeDefined();
      expect(empty!.displayId).toBeUndefined();
      expect(empty!.net).toBe(-100);
    });
  });

  describe('RedX — structure-only / fail-closed', () => {
    let inv: Awaited<ReturnType<typeof parseInvoiceFile>>;
    beforeAll(async () => {
      inv = await parseInvoiceFile({ buffer: load('redx.csv'), filename: 'RedX_966809.csv' });
    });

    it('detects redx as structure-only and not proven', () => {
      expect(inv.meta.provider).toBe('redx');
      expect(inv.meta.isStructureOnly).toBe(true);
      expect(inv.meta.proven).toBe(false);
      expect(inv.meta.rowCount).toBe(4);
      expect(inv.meta.blankLineCount).toBeGreaterThanOrEqual(1); // leading blank line 1 handled
      expect(inv.meta.rawHeaders).toContain('Parcel Id');
    });

    it('classifies every row as FOOTER and surfaces footer totals', () => {
      expect(inv.rows.every((r) => r.rowClass === 'FOOTER')).toBe(true);
      expect(inv.meta.rawTotals).toBeDefined();
      expect(inv.meta.rawTotals!['cash collected']).toBe(1308);
      expect(inv.meta.rawTotals!['delivery charge']).toBe(130);
      expect(inv.meta.rawTotals!['cod charge']).toBe(16);
      expect(inv.meta.rawTotals!['cash paid']).toBe(1454);
    });

    it('keeps the "15%" string verbatim (not parsed as money)', () => {
      const totalRow = inv.rows.find((r) => r.raw['Parcel Id'] === 'Total');
      expect(totalRow).toBeDefined();
      expect(totalRow!.declared['Vat']).toBe('15%');
    });
  });

  describe('double-encoded Bengali repair (§13)', () => {
    it('repairDoubleEncoding reverses one round of latin1↔utf8 mojibake', () => {
      const original = 'মানুষ';
      const mojibake = Buffer.from(original, 'utf8').toString('latin1');
      expect(repairDoubleEncoding(mojibake)).toBe(original);
      expect(repairDoubleEncoding('Customer')).toBe('Customer');
      expect(repairDoubleEncoding('')).toBe('');
    });

    it('the parser repairs a double-encoded name end-to-end through the carrybee pipeline', async () => {
      const original = 'মানুষ';
      // the bytes the parser will see (file bytes = utf8 of the mojibake string)
      const mojibake = Buffer.from(original, 'utf8').toString('latin1');

      const header =
        'Consignment_id,merchant_order_id,Recipient Name,Recipient Phone,Collectable Amount,Collected Amount,COD_fee,Delivery_fee,Additional_charge,Discount,Total Fee,Compensation,Adjustment,Billing_amount,Weight,Delivery_status,Delivered_by_hub_name,Created_date,Delivered_date,Invoiced_date,Invoice_number,Payout_method,Payment_status,Store_name';
      const values = [
        'SYNTH1', 'ORD-SYN', mojibake, '9999', '0.00', '0.00', '0.00', '0.00', '0.00',
        '0.00', '0.00', '0.00', '0.00', '100.00', '1.70', 'delivered', 'hub',
        '2026-05-10', '2026-03-02', '2026-05-11', 'I110526K3DJ5N', 'bank', 'paid', 'BD Fashion',
      ];
      const csv = header + '\n' + values.join(',');

      const inv = await parseInvoiceFile({ buffer: Buffer.from(csv, 'utf8'), filename: 'carrybee-encoding-test.csv' });
      expect(inv.meta.provider).toBe('carrybee');
      expect(inv.rows[0].recipientName).toBe('মানুষ');
      expect(inv.rows[0].net).toBe(-100);
    });
  });

  describe('file detection', () => {
    it('throws on an unrecognised provider', async () => {
      const csv = 'foo,bar,baz\n1,2,3\n';
      await expect(
        parseInvoiceFile({ buffer: Buffer.from(csv, 'utf8'), filename: 'unknown.csv' }),
      ).rejects.toThrow(FileTypeUnsupportedError);
    });
  });
});
