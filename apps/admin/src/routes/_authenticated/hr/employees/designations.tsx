import { createFileRoute } from '@tanstack/react-router'
import DesignationsPage from '@/features/designations'

export const Route = createFileRoute('/_authenticated/hr/employees/designations')({
  component: DesignationsPage,
})