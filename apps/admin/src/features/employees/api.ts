import { apiClient } from '@/lib/api-client'

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship'
export type EmployeeStatus = 'active' | 'inactive' | 'terminated' | 'resigned' | 'on_leave' | 'suspended'
export type EmployeeGender = 'MALE' | 'FEMALE' | 'OTHER'
export type AttendanceMethod = 'APP' | 'MACHINE' | 'NONE'
export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'OTHERS'
export type BankVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface EmployeeBankAccount {
  id: string
  employeeId: string
  bankName: string
  branchName?: string | null
  accountName: string
  accountNumber: string
  accountType?: BankAccountType | null
  routingNumber?: string | null
  isPrimary: boolean
  verificationStatus: BankVerificationStatus
  verificationNote?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBankAccountDto {
  bankName: string
  branchName?: string
  accountName: string
  accountNumber: string
  accountType?: BankAccountType
  routingNumber?: string
  isPrimary?: boolean
  verificationStatus?: BankVerificationStatus
  notes?: string
}

export interface UpdateEmployeeDto {
  status?: EmployeeStatus
  exitDate?: string | null
  reportingToId?: string | null
  departmentId?: string | null
  designationId?: string | null
  employmentType?: EmploymentType
  salary?: number
  bankName?: string
  bankAccountNo?: string
  notes?: string
  dateOfBirth?: string | null
  gender?: EmployeeGender | null
  nationality?: string | null
  nidNumber?: string | null
  presentAddress?: string | null
  permanentAddress?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emergencyContactRelation?: string | null
  confirmationDate?: string | null
  exitReason?: string | null
  attendanceMethod?: AttendanceMethod
}

// G-15 nested payload captured at employee creation.
export interface SalaryStructureInput {
  basicSalary: number
  houseAllowance?: number
  medicalAllowance?: number
  transportAllowance?: number
  otherAllowance?: number
  taxDeduction?: number
  insuranceDeduction?: number
  otherDeduction?: number
  effectiveFrom?: string
}

export interface BankAccountInput {
  bankName: string
  branchName?: string
  accountName?: string
  accountNumber: string
  accountType?: BankAccountType
  routingNumber?: string
  isPrimary?: boolean
}

export interface CreateEmployeeDto {
  betterAuthUserId: string
  departmentId?: string
  designationId?: string
  accessPresetId?: string
  reportingToId?: string
  employmentType?: EmploymentType
  joiningDate: string
  status?: EmployeeStatus
  exitDate?: string
  notes?: string
  attendanceMethod?: AttendanceMethod
  salaryStructure?: SalaryStructureInput
  bankAccount?: BankAccountInput
}

export interface SalaryStructureEntry {
  id: string
  basicSalary: number
  houseAllowance: number
  medicalAllowance: number
  transportAllowance: number
  otherAllowance: number
  taxDeduction: number
  insuranceDeduction: number
  otherDeduction: number
  totalEarnings: number
  totalDeductions: number
  netSalary: number
  effectiveFrom: string
  effectiveTo?: string | null
  isActive: boolean
}

export interface EmployeeResponse {
  id: string
  employeeId: string
  betterAuthUserId: string
  departmentId?: string | null
  designationId?: string | null
  accessPresetId?: string | null
  employmentType: EmploymentType
  status: EmployeeStatus
  joiningDate: string
  exitDate?: string | null
  salary?: number | null
  bankAccountNo?: string | null
  bankName?: string | null
  profilePictureUrl?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  department?: { id: string; name: string; slug: string } | null
  designation?: { id: string; name: string; slug: string; level?: number | null } | null
  accessPreset?: { id: string; name: string } | null
  betterAuthUser?: { id: string; name: string; email: string; role: string } | null
  reportingTo?: {
    id: string
    employeeId: string
    betterAuthUser?: { id?: string; name: string } | null
  } | null
  dateOfBirth?: string | null
  gender?: EmployeeGender | null
  nationality?: string | null
  nidNumber?: string | null
  presentAddress?: string | null
  permanentAddress?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emergencyContactRelation?: string | null
  confirmationDate?: string | null
  exitReason?: string | null
  attendanceMethod: AttendanceMethod
  bankAccounts?: EmployeeBankAccount[]
  salaryStructures?: SalaryStructureEntry[]
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
  designationId?: string
  reportingToId?: string
  attendanceMethod?: string
  search?: string
  sortBy?: 'createdAt' | 'joiningDate' | 'employeeId' | 'name'
  sortOrder?: 'asc' | 'desc'
}

export const employeesApi = {
  list: (query?: EmployeesQuery) =>
    apiClient.get<PaginatedResponse<EmployeeResponse>>('/employees', { params: query }),
  get: (id: string) =>
    apiClient.get<EmployeeResponse>(`/employees/${id}`),
  create: (data: CreateEmployeeDto) =>
    apiClient.post<EmployeeResponse>('/employees', data),
  update: (id: string, data: any) =>
    apiClient.put<EmployeeResponse>(`/employees/${id}`, data),
  delete: (id: string) =>
    apiClient.delete(`/employees/${id}`),
  listBankAccounts: (employeeId: string) =>
    apiClient.get<EmployeeBankAccount[]>(`/employees/${employeeId}/bank-accounts`),
  createBankAccount: (employeeId: string, data: CreateBankAccountDto) =>
    apiClient.post<EmployeeBankAccount>(`/employees/${employeeId}/bank-accounts`, data),
  updateBankAccount: (id: string, data: Partial<CreateBankAccountDto>) =>
    apiClient.patch<EmployeeBankAccount>(`/employees/bank-accounts/${id}`, data),
  deleteBankAccount: (id: string) =>
    apiClient.delete(`/employees/bank-accounts/${id}`),
  setPrimaryBankAccount: (id: string) =>
    apiClient.post<EmployeeBankAccount>(`/employees/bank-accounts/${id}/primary`),
}

export async function getEmployee(id: string) {
  const res = await apiClient.get<EmployeeResponse>(`/employees/${id}`)
  return res.data
}

export async function updateEmployee(id: string, dto: UpdateEmployeeDto) {
  const res = await apiClient.put<EmployeeResponse>(`/employees/${id}`, dto)
  return res.data
}
