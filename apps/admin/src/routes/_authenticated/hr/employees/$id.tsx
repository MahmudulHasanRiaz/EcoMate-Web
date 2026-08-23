import { createFileRoute } from '@tanstack/react-router'
import { EmployeeDetailPage } from '@/features/employees/components/employee-detail'

export const Route = createFileRoute('/_authenticated/hr/employees/$id')({
  component: EmployeeDetailRoute,
})

function EmployeeDetailRoute() {
  const { id } = Route.useParams()
  return <EmployeeDetailPage employeeId={id} />
}