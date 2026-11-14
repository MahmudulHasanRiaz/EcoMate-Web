import { createFileRoute } from '@tanstack/react-router'
import { ProductAvailability } from '@/features/channels/product-availability'
export const Route = createFileRoute('/_authenticated/op/products/store-availability')({ component: ProductAvailability })
