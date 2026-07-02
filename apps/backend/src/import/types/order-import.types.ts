export interface ParsedOrderItem {
  name: string;
  sku: string;
  productId: string;
  quantity: number;
  price: number;
  total: number;
  subtotal: number;
  variationId: string;
}

export interface OrderImportRow {
  rowNumber: number;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  paidDate: string;
  status: string;
  shippingTotal: number;
  discountTotal: number;
  feeTotal: number;
  orderTotal: number;
  orderSubtotal: number;
  orderCurrency: string;
  paymentMethod: string;
  paymentMethodTitle: string;
  transactionId: string;
  customerNote: string;
  orderNotes: string;
  billingFirstName: string;
  billingLastName: string;
  billingCompany: string;
  billingEmail: string;
  billingPhone: string;
  billingAddress1: string;
  billingAddress2: string;
  billingPostcode: string;
  billingCity: string;
  billingState: string;
  billingCountry: string;
  shippingFirstName: string;
  shippingLastName: string;
  shippingCompany: string;
  shippingPhone: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingPostcode: string;
  shippingCity: string;
  shippingState: string;
  shippingCountry: string;
  items: ParsedOrderItem[];
}

export interface OrderImportSummary {
  ordersImported: number;
  ordersSkipped: number;
  customersCreated: number;
  customersFound: number;
  errors: number;
}

export interface OrderImportError {
  rowNumber: number;
  orderId: string;
  errorType: string;
  message: string;
}
