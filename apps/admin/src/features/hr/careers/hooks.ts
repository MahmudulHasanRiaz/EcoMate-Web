import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  careersApi,
  type CreateJobPostingDto,
  type UpdateJobApplicationDto,
  type UpdateJobPostingDto,
} from './api'

function errMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } } }
  const message = err?.response?.data?.message
  if (Array.isArray(message)) return message.join(', ')
  return message || fallback
}

// ===== Job Postings =====

export function useJobPostingsQuery(query?: { status?: string; page?: number; perPage?: number }) {
  return useQuery({
    queryKey: ['careers-postings', query?.status, query?.page, query?.perPage],
    queryFn: () => careersApi.listPostings(query),
  })
}

export function useCreatePostingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateJobPostingDto) => careersApi.createPosting(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers-postings'] })
      toast.success('Job posting created')
    },
    onError: (e: unknown) => toast.error(errMessage(e, 'Error creating job posting')),
  })
}

export function useUpdatePostingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateJobPostingDto }) =>
      careersApi.updatePosting(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers-postings'] })
      toast.success('Job posting updated')
    },
    onError: (e: unknown) => toast.error(errMessage(e, 'Error updating job posting')),
  })
}

// ===== Job Applications =====

export function useJobApplicationsQuery(query?: { jobId?: string; status?: string; page?: number; perPage?: number }) {
  return useQuery({
    queryKey: ['careers-applications', query?.jobId, query?.status, query?.page, query?.perPage],
    queryFn: () => careersApi.listApplications(query),
  })
}

export function useJobApplicationQuery(id: string | null) {
  return useQuery({
    queryKey: ['careers-application', id],
    queryFn: () => careersApi.getApplication(id as string),
    enabled: !!id,
  })
}

export function useUpdateApplicationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateJobApplicationDto }) =>
      careersApi.updateApplication(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers-applications'] })
      queryClient.invalidateQueries({ queryKey: ['careers-application'] })
      toast.success('Application updated')
    },
    onError: (e: unknown) => toast.error(errMessage(e, 'Error updating application')),
  })
}

export function useDeleteCvMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => careersApi.deleteCv(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers-applications'] })
      queryClient.invalidateQueries({ queryKey: ['careers-application'] })
      toast.success('CV deleted')
    },
    onError: (e: unknown) => toast.error(errMessage(e, 'Error deleting CV')),
  })
}
