import { apiClient } from '@/lib/api-client'

export interface JobPostingDepartment {
  id: string
  name: string
  slug: string
}

export interface JobPostingDesignation {
  id: string
  name: string
  slug: string
}

export interface JobPostingResponse {
  id: string
  slug: string
  title: string
  departmentId: string | null
  designationId: string | null
  department?: JobPostingDepartment | null
  designation?: JobPostingDesignation | null
  location: string
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryDisplay: string | null
  description: string
  requirements: string | null
  responsibilities: string | null
  benefits: string[] | null
  deadline: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'
  sortOrder: number
  createdById: string | null
  createdAt: string
  updatedAt: string
  _count?: { applications: number }
}

export interface JobApplicationResponse {
  id: string
  jobPostingId: string
  jobPosting?: { id: string; title: string; slug: string }
  fullName: string
  email: string
  phone: string
  coverLetter: string | null
  cvUrl: string | null
  cvOriginalName: string | null
  cvDeletedAt: string | null
  cvDeletedById: string | null
  portfolioUrl: string | null
  status: 'NEW' | 'SHORTLISTED' | 'INTERVIEW' | 'REJECTED' | 'HIRED'
  internalNote: string | null
  reviewedById: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CreateJobPostingDto {
  title: string
  departmentId?: string | null
  designationId?: string | null
  location: string
  employmentType: string
  salaryMin?: number | null
  salaryMax?: number | null
  salaryDisplay?: string | null
  description: string
  requirements?: string | null
  responsibilities?: string | null
  benefits?: string[] | null
  deadline?: string | null
  status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED'
  sortOrder?: number
}

export type UpdateJobPostingDto = Partial<CreateJobPostingDto>

export interface UpdateJobApplicationDto {
  status?: JobApplicationResponse['status']
  internalNote?: string | null
}

export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'] as const
export const JOB_POSTING_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const
export const JOB_APPLICATION_STATUSES = ['NEW', 'SHORTLISTED', 'INTERVIEW', 'REJECTED', 'HIRED'] as const

/** Statuses an application in `from` may move to (REJECTED / HIRED are terminal). */
export const NEXT_APPLICATION_STATUSES: Record<JobApplicationResponse['status'], JobApplicationResponse['status'][]> = {
  NEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['HIRED', 'REJECTED'],
  REJECTED: [],
  HIRED: [],
}

export const careersApi = {
  listPostings: (query?: { status?: string; page?: number; perPage?: number }) =>
    apiClient.get<PaginatedResponse<JobPostingResponse>>('/hr/job-postings', { params: query }).then((r) => r.data),

  getPosting: (id: string) =>
    apiClient.get<JobPostingResponse>(`/hr/job-postings/${id}`).then((r) => r.data),

  createPosting: (data: CreateJobPostingDto) =>
    apiClient.post<JobPostingResponse>('/hr/job-postings', data).then((r) => r.data),

  updatePosting: (id: string, data: UpdateJobPostingDto) =>
    apiClient.patch<JobPostingResponse>(`/hr/job-postings/${id}`, data).then((r) => r.data),

  listApplications: (query?: { jobId?: string; status?: string; page?: number; perPage?: number }) =>
    apiClient.get<PaginatedResponse<JobApplicationResponse>>('/hr/job-applications', { params: query }).then((r) => r.data),

  getApplication: (id: string) =>
    apiClient.get<JobApplicationResponse>(`/hr/job-applications/${id}`).then((r) => r.data),

  updateApplication: (id: string, data: UpdateJobApplicationDto) =>
    apiClient.patch<JobApplicationResponse>(`/hr/job-applications/${id}`, data).then((r) => r.data),

  /** Downloads the CV as a Blob (server sends Content-Disposition: attachment). */
  downloadCv: (id: string) =>
    apiClient.get<Blob>(`/hr/job-applications/${id}/cv`, { responseType: 'blob' }).then((r) => r.data),

  /** Deletes the stored CV file and clears the reference; the application stays. */
  deleteCv: (id: string) =>
    apiClient.delete<JobApplicationResponse>(`/hr/job-applications/${id}/cv`).then((r) => r.data),
}
