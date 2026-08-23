import apiClient from "../api-client";

export interface HrProfile {
  id: string;
  employeeId: string;
  betterAuthUser: { name: string; email: string };
  department?: { name: string } | null;
  designation?: { name: string } | null;
  reportingTo?: { employeeId: string; betterAuthUser: { name: string } } | null;
  salary?: number | null;
  salaryStructures?: any[];
  [key: string]: any;
}

export interface SalaryStructure {
  basicSalary: number;
  houseAllowance: number;
  medicalAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  taxDeduction: number;
  insuranceDeduction: number;
  otherDeduction: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  [key: string]: any;
}

export interface Payslip {
  id: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  netPay: number;
  status: string;
  paidAt?: string | null;
}

export interface PayrollPayment {
  id: string;
  amount: number;
  paidAt: string;
  method?: string;
  referenceNo?: string;
  note?: string;
}

export interface CommissionEarning {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  createdAt: string;
  order?: { displayId?: string };
}

export interface EmployeeEarning {
  id: string;
  type: string;
  amount: number;
  reason?: string;
  applicableFrom?: string;
  applicableTo?: string;
  status: string;
}

export interface EmployeeDeduction {
  id: string;
  type: string;
  amount: number;
  reason?: string;
  applicableFrom?: string;
  applicableTo?: string;
  status: string;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  daysPerYear: number;
  isPaid: boolean;
  isActive: boolean;
}

export interface LeaveRequest {
  id: string;
  type: { name: string; code: string };
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  decisionNote?: string;
}

export interface Paginated<T> {
  data: T[];
  meta?: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

function qp(page?: number, perPage?: number) {
  return { page, perPage };
}

export async function getHrProfile() {
  const { data } = await apiClient.get<HrProfile>("/hr/my/profile");
  return data;
}

export async function getHrSalary() {
  const { data } = await apiClient.get<SalaryStructure>("/hr/my/salary");
  return data;
}

export async function getHrPayslips(page = 1, perPage = 20) {
  const { data } = await apiClient.get<Paginated<Payslip>>("/hr/my/payslips", {
    params: qp(page, perPage),
  });
  return data;
}

export async function getHrPayslipPayments(id: string) {
  const { data } = await apiClient.get<PayrollPayment[]>(
    `/hr/my/payslips/${id}/payments`,
  );
  return data;
}

export async function getHrCommissions(page = 1, perPage = 20) {
  const { data } = await apiClient.get<Paginated<CommissionEarning>>(
    "/hr/my/commissions",
    { params: qp(page, perPage) },
  );
  return data;
}

export async function getHrEarnings(page = 1, perPage = 20) {
  const { data } = await apiClient.get<Paginated<EmployeeEarning>>(
    "/hr/my/earnings",
    { params: qp(page, perPage) },
  );
  return data;
}

export async function getHrDeductions(page = 1, perPage = 20) {
  const { data } = await apiClient.get<Paginated<EmployeeDeduction>>(
    "/hr/my/deductions",
    { params: qp(page, perPage) },
  );
  return data;
}

export async function getHrSchedule() {
  const { data } = await apiClient.get<{ days: number[] }>("/hr/my/schedule");
  return data;
}

export async function getHrLeaveTypes() {
  const { data } = await apiClient.get<LeaveType[]>("/hr/my/leave-types");
  return data;
}

export async function getHrLeaveRequests(page = 1, perPage = 20) {
  const { data } = await apiClient.get<Paginated<LeaveRequest>>(
    "/hr/my/leave-requests",
    { params: qp(page, perPage) },
  );
  return data;
}

export async function createHrLeaveRequest(dto: {
  typeId: string;
  startDate: string;
  endDate: string;
  days?: number;
  reason: string;
}) {
  const { data } = await apiClient.post<LeaveRequest>(
    "/hr/my/leave-requests",
    dto,
  );
  return data;
}

export async function cancelHrLeaveRequest(id: string) {
  const { data } = await apiClient.patch<LeaveRequest>(
    `/hr/my/leave-requests/${id}/cancel`,
  );
  return data;
}
