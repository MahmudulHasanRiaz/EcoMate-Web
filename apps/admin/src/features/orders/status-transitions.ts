export interface StatusNode {
  id: string
  name: string
  color: string
  x: number
  y: number
  column: number
  row: number
}

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Payment Pending', 'Hold', 'Recall', 'No Response', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Recall', 'No Response', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Recall', 'No Response', 'Cancelled'],
  // E (owner-locked): Recall / No Response — the call-center PRE-CONFIRMATION
  // pair (called once → retried → still nothing). Free movement inside the
  // pre-confirmation group, normal Confirmed/Cancelled exits; once an order is
  // Confirmed the main journey owns it — no way back in.
  'Recall': ['Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'No Response', 'Confirmed', 'Cancelled'],
  'No Response': ['Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'Recall', 'Confirmed', 'Cancelled'],
  'Hold': ['Pending', 'Recall', 'No Response', 'Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
  'Packed': ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  'Shipping': ['Delivered', 'Partial', 'Return Pending'],
  'Delivered': ['Return Pending'],
  // Partial must be resolved via the RTN return-order workflow — the generic
  // Partial → Delivered shortcut is intentionally removed.
  'Partial': ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  'Returned': ['Damaged'],
  'Cancelled': ['Hold', 'Confirmed'],
  'Damaged': [],
}

export const STATUS_COLORS: Record<string, string> = {
  'Pending': '#F59E0B',
  'Payment Pending': '#F59E0B',
  'Payment Verifying': '#8B5CF6',
  'Hold': '#D97706',
  'Recall': '#F97316',
  'No Response': '#64748B',
  'Confirmed': '#3B82F6',
  'Packed': '#059669',
  'Packing Hold': '#D97706',
  'Shipping': '#06B6D4',
  'Delivered': '#10B981',
  'Partial': '#F59E0B',
  'Return Pending': '#EC4899',
  'Returned': '#DC2626',
  'Damaged': '#991B1B',
  'Cancelled': '#EF4444',
}

export const STATUS_LAYOUT: StatusNode[] = [
  { id: '0', name: 'Pending', color: STATUS_COLORS['Pending'], x: 0, y: 0, column: 0, row: 0 },
  { id: '1', name: 'Payment Pending', color: STATUS_COLORS['Payment Pending'], x: 0, y: 0, column: 1, row: 0 },
  { id: '2', name: 'Payment Verifying', color: STATUS_COLORS['Payment Verifying'], x: 0, y: 0, column: 2, row: 0 },
  { id: '3', name: 'Confirmed', color: STATUS_COLORS['Confirmed'], x: 0, y: 0, column: 3, row: 0 },
  { id: '4', name: 'Packed', color: STATUS_COLORS['Packed'], x: 0, y: 0, column: 4, row: 0 },
  { id: '5', name: 'Shipping', color: STATUS_COLORS['Shipping'], x: 0, y: 0, column: 5, row: 0 },
  { id: '6', name: 'Delivered', color: STATUS_COLORS['Delivered'], x: 0, y: 0, column: 6, row: 0 },
  { id: '7', name: 'Hold', color: STATUS_COLORS['Hold'], x: 0, y: 0, column: 2, row: 1 },
  { id: '8', name: 'Packing Hold', color: STATUS_COLORS['Packing Hold'], x: 0, y: 0, column: 4, row: 1 },
  { id: '9', name: 'Partial', color: STATUS_COLORS['Partial'], x: 0, y: 0, column: 5, row: 1 },
  { id: '10', name: 'Return Pending', color: STATUS_COLORS['Return Pending'], x: 0, y: 0, column: 6, row: 1 },
  { id: '11', name: 'Returned', color: STATUS_COLORS['Returned'], x: 0, y: 0, column: 7, row: 0 },
  { id: '12', name: 'Cancelled', color: STATUS_COLORS['Cancelled'], x: 0, y: 0, column: 7, row: 1 },
  { id: '13', name: 'Damaged', color: STATUS_COLORS['Damaged'], x: 0, y: 0, column: 8, row: 0 },
  // E: call-center pair — pre-confirmation branches under the payment column.
  { id: '14', name: 'Recall', color: STATUS_COLORS['Recall'], x: 0, y: 0, column: 2, row: 2 },
  { id: '15', name: 'No Response', color: STATUS_COLORS['No Response'], x: 0, y: 0, column: 2, row: 3 },
]