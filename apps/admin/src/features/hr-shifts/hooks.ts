import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hrShiftsApi, type CreateShiftPresetPayload, type UpdateShiftPresetPayload } from './api'

const PRESETS_KEY = 'hr-shift-presets'
const ROTATION_KEY = 'hr-shift-rotation'

export function useShiftPresetsQuery(includeInactive = false) {
  return useQuery({
    queryKey: [PRESETS_KEY, includeInactive],
    queryFn: () => hrShiftsApi.list(includeInactive).then((r) => r.data),
  })
}

export function useCreateShiftPresetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateShiftPresetPayload) => hrShiftsApi.create(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PRESETS_KEY] })
      toast.success('Shift preset created')
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Could not create shift preset'),
  })
}

export function useUpdateShiftPresetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateShiftPresetPayload }) =>
      hrShiftsApi.update(id, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PRESETS_KEY] })
      queryClient.invalidateQueries({ queryKey: [ROTATION_KEY] })
      toast.success('Shift preset updated')
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Could not update shift preset'),
  })
}

export function useDeactivateShiftPresetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrShiftsApi.deactivate(id).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PRESETS_KEY] })
      toast.success('Shift preset removed')
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Could not remove shift preset'),
  })
}

export function useShiftRotationQuery(employeeId: string) {
  return useQuery({
    queryKey: [ROTATION_KEY, employeeId],
    queryFn: () => hrShiftsApi.rotation(employeeId).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useSetRotationDayMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dayOfWeek, shiftPresetId }: { dayOfWeek: number; shiftPresetId: string }) =>
      hrShiftsApi
        .setRotationDay(employeeId, dayOfWeek, shiftPresetId)
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROTATION_KEY, employeeId] })
      queryClient.invalidateQueries({ queryKey: ['hr-history', employeeId] })
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Could not update shift rotation'),
  })
}

export function useClearRotationDayMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dayOfWeek: number) =>
      hrShiftsApi.clearRotationDay(employeeId, dayOfWeek).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROTATION_KEY, employeeId] })
      queryClient.invalidateQueries({ queryKey: ['hr-history', employeeId] })
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Could not clear shift'),
  })
}