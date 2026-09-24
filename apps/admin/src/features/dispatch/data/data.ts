export const DISPATCH_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched', color: 'bg-gray-500' },
  { value: 'HANDED_OVER', label: 'Handed Over', color: 'bg-info' },
  { value: 'PICKED_UP', label: 'Picked Up', color: 'bg-accent-cyan' },
  { value: 'IN_TRANSIT', label: 'In Transit', color: 'bg-accent-violet' },
  { value: 'ASSIGNED_TO_RIDER', label: 'Assigned to Rider', color: 'bg-accent-pink' },
  { value: 'HOLD', label: 'Hold', color: 'bg-warning' },
  { value: 'DELIVERED', label: 'Delivered', color: 'bg-success' },
  { value: 'PARTIAL', label: 'Partial', color: 'bg-warning' },
  { value: 'RETURN_PENDING', label: 'Return Pending', color: 'bg-warning' },
  { value: 'RETURNED', label: 'Returned', color: 'bg-danger' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-danger' },
] as const

export const ALL_COURIERS = [
  { value: 'steadfast', label: 'Steadfast', color: '#00B795' },
  { value: 'pathao', label: 'Pathao', color: '#FF5722' },
  { value: 'redx', label: 'Redx', color: '#E53E3E' },
  { value: 'carrybee', label: 'Carrybee', color: '#6B46C1' },
] as const

export function getCourierColor(value: string): string | undefined {
  return ALL_COURIERS.find((c) => c.value === value)?.color
}

export function getCourierOptions(hasFeature: (key: string) => boolean) {
  return ALL_COURIERS.filter((c) => hasFeature(`courier_${c.value}`))
}
