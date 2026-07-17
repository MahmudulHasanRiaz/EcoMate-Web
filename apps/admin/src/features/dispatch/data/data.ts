export const DISPATCH_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched', color: 'bg-gray-500' },
  { value: 'HANDED_OVER', label: 'Handed Over', color: 'bg-blue-500' },
  { value: 'PICKED_UP', label: 'icked Up', color: 'bg-cyan-500' },
  { value: 'IN_TRANSIT', label: 'In Transit', color: 'bg-indigo-500' },
  { value: 'ASSIGNED_TO_RIDER', label: 'Assigned to Rider', color: 'bg-purple-500' },
  { value: 'HOLD', label: 'Hold', color: 'bg-amber-500' },
  { value: 'DELIVERED', label: 'Delivered', color: 'bg-green-500' },
  { value: 'PARTIAL', label: 'Partial', color: 'bg-yellow-500' },
  { value: 'RETURN_PENDING', label: 'Return Pending', color: 'bg-orange-500' },
  { value: 'RETURNED', label: 'Returned', color: 'bg-red-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-gray-700' },
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
