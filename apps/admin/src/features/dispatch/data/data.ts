export const DISPATCH_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched', color: 'bg-gray-500' },
  { value: 'HANDED_OVER', label: 'Handed Over', color: 'bg-blue-500' },
  { value: 'PICKED_UP', label: 'Picked Up', color: 'bg-cyan-500' },
  { value: 'IN_TRANSIT', label: 'In Transit', color: 'bg-indigo-500' },
  { value: 'DELIVERED', label: 'Delivered', color: 'bg-green-500' },
  { value: 'PARTIAL', label: 'Partial', color: 'bg-yellow-500' },
  { value: 'RETURN_PENDING', label: 'Return Pending', color: 'bg-orange-500' },
  { value: 'RETURNED', label: 'Returned', color: 'bg-red-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-gray-700' },
] as const

export const ALL_COURIERS = [
  { value: 'steadfast', label: 'Steadfast' },
  { value: 'pathao', label: 'Pathao' },
  { value: 'redx', label: 'Redx' },
  { value: 'carrybee', label: 'Carrybee' },
] as const

export function getCourierOptions(hasFeature: (key: string) => boolean) {
  return ALL_COURIERS.filter((c) => hasFeature(`courier_${c.value}`))
}
