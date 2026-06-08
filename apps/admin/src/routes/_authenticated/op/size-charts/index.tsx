import { createFileRoute } from '@tanstack/react-router'
import { SizeCharts } from '@/features/size-charts'

export const Route = createFileRoute('/_authenticated/op/size-charts/')({
  component: SizeCharts,
})
