import { apiClient } from '@/lib/api-client'

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship'
export type EmployeeStatus = 'active' | 'inactive' | 'terminated' | 'resigned' | 'on_leave' | 'suspended'
export type EmployeeGender = 'MALE' | 'FEMALE' | 'OTHER'
export type AttendanceMethod = 'APP' | 'MACHINE' | 'NONE'
export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'OTHERS'
export type BankVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'

// G-32: never render raw enum values — map them to user-facing labels.
export const GENDER_LABELS: Record<EmployeeGender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
}

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  APP: 'App',
  MACHINE: 'Machine',
  NONE: 'None (disabled)',
}

export const STATUS_BADGE: Record<EmployeeStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  terminated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  resigned: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  on_leave: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  suspended: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
}

export const EMPLOYMENT_TYPE_BADGE: Record<EmploymentType, string> = {
  full_time: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  part_time: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  contract: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  internship: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  internship: 'Internship',
}

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Terminated',
  resigned: 'Resigned',
  on_leave: 'On Leave',
  suspended: 'Suspended',
}

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
  verificationNote?: string
  notes?: string
}

export interface UpdateEmployeeDto {
  status?: EmployeeStatus
  joiningDate?: string | null
  exitDate?: string | null
  reportingToId?: string | null
  departmentId?: string | null
  designationId?: string | null
  accessPresetId?: string | null
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
  shiftPresetId?: string
  shiftDays?: number[]
  shiftRotations?: { dayOfWeek: number; presetId: string }[]
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
  dateOfBirth?: string
  gender?: EmployeeGender
  nationality?: string
  nidNumber?: string
  presentAddress?: string
  permanentAddress?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelation?: string
  confirmationDate?: string
  salaryStructure?: SalaryStructureInput
  bankAccount?: BankAccountInput
  shiftPresetId?: string
  shiftDays?: number[]
  shiftRotations?: { dayOfWeek: number; presetId: string }[]
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
  betterAuthUser?: { id: string; name: string; email: string; role: string; image?: string | null } | null
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
