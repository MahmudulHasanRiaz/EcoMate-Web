import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { backupApi } from '../api'

export function useBackups(params?: Record<string, any>) {
  return useQuery({
    queryKey: ['backups', params],
    queryFn: () => backupApi.list(params),
    refetchInterval: 30_000, // poll for status changes
  })
}

export function useBackup(id: string) {
  return useQuery({
    queryKey: ['backup', id],
    queryFn: () => backupApi.get(id),
    enabled: !!id,
  })
}

export function useTriggerBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scope: 'db_only' | 'db_files') => backupApi.create(scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useRestoreBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => backupApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useRestoreUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => backupApi.uploadRestore(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useToggleLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      backupApi.toggleLock(id, locked),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useDeleteBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => backupApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  })
}

export function useBackupSettings() {
  return useQuery({
    queryKey: ['backup-settings'],
    queryFn: () => backupApi.getSettings(),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: Record<string, string>) => backupApi.updateSettings(settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-settings'] }),
  })
}