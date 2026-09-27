// ── Provider descriptors (PRD §5, §10) — data-driven column maps + proven rules.
// Every formula below is mathematically proven against the real fixtures in
// __fixtures__/ (anonymised copies of the source files). Providers without a
// proven netRule (RedX) are structure-only and fail-closed (§11).

import { Provider, RowClass, RowKind } from './types';
import { redxFooterDetect } from './redx-footer';

export type NetRule =
  | 'declared_payout'
  | 'collected_minus_charges'
  | 'billing_when_no_collection'
  | 'none';

export interface ColumnSpec {
  header: string;
  field: string;
  kind:
    | 'collected'
    | 'charges'
    | 'net'
    | 'collectable'
    | 'consignment'
    | 'order'
    | 'tracking'
    | 'recipient_name'
    | 'recipient_phone'
    | 'date'
    | 'status'
    | 'delivery_status'
    | 'payout_method'
    | 'payment_status'
    | 'store'
    | 'invoice_no'
    | 'text';
  /** only for charge components: sign applied to the parsed value */
  sign?: number;
}

export interface ProviderDescriptor {
  provider: Provider;
  /** column specs for the canonical fields */
  columns: ColumnSpec[];
  /** charge component specs (header + sign); used to compute the component sum
   * and assert it equals the provider-declared charges (Pathao Final_Fee) */
  chargeComponents: { header: string; field: string; sign: number }[];
  /** header supplying gross collection */
  collectedHeader: string;
  /** header supplying declared net (provider-declared payout) */
  netHeader?: string;
  /** header supplying provider-computed charges total (else derived from components) */
  chargesHeader?: string;
  /** header supplying the billing amount for billing_when_no_collection rules */
  billingHeader?: string;
  /** header supplying collectable value */
  collectableHeader?: string;
  netRule: NetRule;
  kindHeader: string;
  kindMap: Record<string, RowKind>;
  identifierOrder: ('consignmentId' | 'displayId' | 'trackingCode' | 'orderId')[];
  footerDetect: (firstCellValue: string) => boolean;
  structureOnly: boolean;
  /** extra provider-specific fields surfaced verbatim on the row.declared map */
  extraFields: string[];
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    provider: 'pathao',
    // 17 columns; proven against pathao paid_invoice_2026-09-27.csv (4 rows)
    // Final_Fee = Delivery_Fee + COD_fee + Additional_Charge − Discount − Compensation_Cost − Promo_Discount
    // Payout   = Collected_Amount − Final_Fee
    columns: [
      { header: 'Consignment_ID', field: 'consignmentId', kind: 'consignment' },
      { header: 'Merchant_Order_ID', field: 'displayId', kind: 'order' },
      { header: 'Invoice type', field: 'rowKind', kind: 'text' },
      { header: 'Collected_Amount', field: 'collected', kind: 'collected' },
      { header: 'Collectable_Amount', field: 'collectable', kind: 'collectable' },
      { header: 'COD_fee', field: 'cod_fee', kind: 'charges', sign: 1 },
      { header: 'Delivery_Fee', field: 'delivery_fee', kind: 'charges', sign: 1 },
      { header: 'Additional_Charge', field: 'additional_charge', kind: 'charges', sign: 1 },
      { header: 'Discount', field: 'discount', kind: 'charges', sign: -1 },
      { header: 'Compensation_Cost', field: 'compensation', kind: 'charges', sign: -1 },
      { header: 'Promo_Discount', field: 'promo_discount', kind: 'charges', sign: -1 },
      { header: 'Final_Fee', field: 'final_fee', kind: 'charges' },
      { header: 'Payout', field: 'payout', kind: 'net' },
      { header: 'Recipient_Name', field: 'recipientName', kind: 'recipient_name' },
      { header: 'Recipient_Phone', field: 'recipientPhone', kind: 'recipient_phone' },
      { header: 'Created_Date', field: 'createdDate', kind: 'date' },
      { header: 'Store_name', field: 'store', kind: 'store' },
    ],
    chargeComponents: [
      { header: 'COD_fee', field: 'cod_fee', sign: 1 },
      { header: 'Delivery_Fee', field: 'delivery_fee', sign: 1 },
      { header: 'Additional_Charge', field: 'additional_charge', sign: 1 },
      { header: 'Discount', field: 'discount', sign: -1 },
      { header: 'Compensation_Cost', field: 'compensation', sign: -1 },
      { header: 'Promo_Discount', field: 'promo_discount', sign: -1 },
    ],
    collectedHeader: 'Collected_Amount',
    netHeader: 'Payout',
    chargesHeader: 'Final_Fee',
    collectableHeader: 'Collectable_Amount',
    netRule: 'declared_payout',
    kindHeader: 'Invoice type',
    kindMap: {
      delivery: 'DELIVERY',
      insta_fee: 'FEE_ONLY',
      return: 'RETURN',
      'return request': 'RETURN',
    },
    identifierOrder: ['consignmentId', 'displayId'],
    footerDetect: () => false,
    structureOnly: false,
    extraFields: ['Store_name', 'Created_Date'],
  },
  {
    provider: 'steadfast',
    // Steadfast 2026-09-27-payment-SFC-25442616.xlsx
    // proven: net = COD Amount − Shipping Charge − COD Charge (4780 = 5000 − 170 − 50)
    columns: [
      { header: 'Tracking Code', field: 'trackingCode', kind: 'tracking' },
      { header: 'Order ID', field: 'orderId', kind: 'order' },
      { header: 'Invoice', field: 'invoiceType', kind: 'text' },
      { header: 'COD Amount', field: 'cod_amount', kind: 'collected' },
      { header: 'Shipping Charge', field: 'shipping_charge', kind: 'charges', sign: 1 },
      { header: 'COD Charge', field: 'cod_charge', kind: 'charges', sign: 1 },
      { header: 'Recipient Name', field: 'recipientName', kind: 'recipient_name' },
      { header: 'Recipient Phone', field: 'recipientPhone', kind: 'recipient_phone' },
      { header: 'Delivery Status', field: 'deliveryStatus', kind: 'delivery_status' },
      { header: 'Approval Status', field: 'approvalStatus', kind: 'status' },
      { header: 'Payment Status', field: 'paymentStatus', kind: 'payment_status' },
      { header: 'Rider', field: 'rider', kind: 'text' },
      { header: 'Created At', field: 'createdDate', kind: 'date' },
    ],
    chargeComponents: [
      { header: 'Shipping Charge', field: 'shipping_charge', sign: 1 },
      { header: 'COD Charge', field: 'cod_charge', sign: 1 },
    ],
    collectedHeader: 'COD Amount',
    chargesHeader: undefined, // derived from components
    netRule: 'collected_minus_charges',
    kindHeader: 'Delivery Status',
    kindMap: {
      delivered: 'DELIVERY',
      returned: 'RETURN',
      return: 'RETURN',
      cancelled: 'UNKNOWN',
    },
    identifierOrder: ['trackingCode', 'orderId'],
    footerDetect: () => false,
    structureOnly: false,
    extraFields: ['Approval Status', 'Delivery Time', 'Rider'],
  },
  {
    provider: 'redx',
    // RedX_966809.csv: structure only, zero data rows. Footer total 1454.00
    // ≠ 1308−130−16(=1162); Vat column holds '15%' string. No proven netRule.
    columns: [
      { header: 'Parcel Id', field: 'parcelId', kind: 'text' },
      { header: 'Cash Collected', field: 'cash_collected', kind: 'collected' },
      { header: 'Delivery Charge', field: 'delivery_charge', kind: 'charges', sign: 1 },
      { header: 'COD Charge', field: 'cod_charge', kind: 'charges', sign: 1 },
      { header: 'Return Charge', field: 'return_charge', kind: 'charges', sign: 1 },
      { header: 'Baki Charge', field: 'baki_charge', kind: 'charges', sign: 1 },
      { header: 'Total Delivery Charge', field: 'total_delivery_charge', kind: 'charges' },
      { header: 'Cash Paid', field: 'cash_paid', kind: 'net' },
      { header: 'Comments', field: 'comments', kind: 'text' },
    ],
    chargeComponents: [],
    collectedHeader: 'Cash Collected',
    netRule: 'none',
    kindHeader: 'Parcel Id',
    kindMap: {},
    identifierOrder: [],
    footerDetect: redxFooterDetect,
    structureOnly: true,
    extraFields: ['Merchant Invoice Id', 'Status', 'Invoice Date'],
  },
  {
    provider: 'carrybee',
    // carrybee invoice-I110526K3DJ5N.csv: 34 rows, ALL Collected Amount = 0 with
    // non-zero Billing_amount → net = −Billing_amount (prepaid billing / billable).
    // Collected Amount > 0 branch is unproven → fail-closed.
    columns: [
      { header: 'Consignment_id', field: 'consignmentId', kind: 'consignment' },
      { header: 'merchant_order_id', field: 'displayId', kind: 'order' },
      { header: 'Collectable Amount', field: 'collectable', kind: 'collectable' },
      { header: 'Collected Amount', field: 'collected', kind: 'collected' },
      { header: 'COD_fee', field: 'cod_fee', kind: 'charges', sign: 1 },
      { header: 'Delivery_fee', field: 'delivery_fee', kind: 'charges', sign: 1 },
      { header: 'Additional_charge', field: 'additional_charge', kind: 'charges', sign: 1 },
      { header: 'Discount', field: 'discount', kind: 'charges', sign: -1 },
      { header: 'Total Fee', field: 'total_fee', kind: 'charges' },
      { header: 'Compensation', field: 'compensation', kind: 'charges', sign: -1 },
      { header: 'Adjustment', field: 'adjustment', kind: 'charges', sign: 1 },
      { header: 'Billing_amount', field: 'billing_amount', kind: 'charges', sign: 1 },
      { header: 'Delivery_status', field: 'deliveryStatus', kind: 'delivery_status' },
      { header: 'Payout_method', field: 'payoutMethod', kind: 'payout_method' },
      { header: 'Payment_status', field: 'paymentStatus', kind: 'payment_status' },
      { header: 'Invoice_number', field: 'invoiceNo', kind: 'invoice_no' },
      { header: 'Created_date', field: 'createdDate', kind: 'date' },
      { header: 'Delivered_date', field: 'deliveredDate', kind: 'date' },
      { header: 'Invoiced_date', field: 'invoicedDate', kind: 'date' },
      { header: 'Weight', field: 'weight', kind: 'text' },
      { header: 'Delivered_by_hub_name', field: 'hub', kind: 'text' },
      { header: 'Recipient Name', field: 'recipientName', kind: 'recipient_name' },
      { header: 'Recipient Phone', field: 'recipientPhone', kind: 'recipient_phone' },
    ],
    chargeComponents: [
      { header: 'Billing_amount', field: 'billing_amount', sign: 1 },
    ],
    collectedHeader: 'Collected Amount',
    collectableHeader: 'Collectable Amount',
    billingHeader: 'Billing_amount',
    netRule: 'billing_when_no_collection',
    kindHeader: 'Delivery_status',
    kindMap: {
      delivered: 'DELIVERY',
      returned: 'RETURN',
      returned_rto: 'RETURN',
      cancelled: 'UNKNOWN',
    },
    identifierOrder: ['consignmentId', 'displayId'],
    footerDetect: () => false,
    structureOnly: false,
    extraFields: ['Weight', 'Payout_method', 'Payment_status', 'Payout_method'],
  },
];

export function getDescriptor(provider: Provider): ProviderDescriptor {
  const d = PROVIDERS.find((p) => p.provider === provider);
  if (!d) throw new Error(`Unknown courier provider: ${provider}`);
  return d;
}
