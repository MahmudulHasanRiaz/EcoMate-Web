import { createFileRoute } from '@tanstack/react-router'
import DepartmentsPage from '@/features/departments'

export const Route = createFileRoute('/_authenticated/hr/employees/departments')({
  component: DepartmentsPage,
})