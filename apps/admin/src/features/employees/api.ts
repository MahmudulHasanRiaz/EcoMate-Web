import { apiClient } from '@/lib/api-client'

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship'
export type EmployeeStatus = 'active' | 'inactive' | 'terminated' | 'resigned'

export interface EmployeeResponse {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  departmentId?: string | null
  designationId?: string | null
  employmentType: EmploymentType
  status: EmployeeStatus
  joiningDate: string
  salary?: number | null
  bankAccountNo?: string | null
  bankName?: string | null
  address?: string | null
  city?: string | null
  emergencyContact?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  department?: { id: string; name: string; slug: string } | null
  designation?: { id: string; name: string; slug: string; level?: number | null } | null
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface EmployeesQuery {
  page?: number
  perPage?: number
  status?: string
  departmentId?: string
}

export const employeesApi = {
  list: (query?: EmployeesQuery) =>
    apiClient.get<PaginatedResponse<EmployeeResponse>>('/employees', { params: query }),
  get: (id: string) =>
    apiClient.get<EmployeeResponse>(`/employees/${id}`),
  create: (data: any) =>
    apiClient.post<EmployeeResponse>('/employees', data),
  update: (id: string, data: any) =>
    apiClient.put<EmployeeResponse>(`/employees/${id}`, data),
  delete: (id: string) =>
    apiClient.delete(`/employees/${id}`),
}
