import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Customers } from '@/features/customers'

const customersSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(10),
  search: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/op/customers/')({
  validateSearch: customersSearchSchema,
  component: Customers,
})
