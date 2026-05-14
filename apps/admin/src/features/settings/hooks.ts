import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from './api'

export function useSettingsQuery() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then((r) => r.data),
  })
}

export function useSettingsMutation() {
  const queryClient = useQueryClient()

  const updateProfile = useMutation({
    mutationFn: settingsApi.updateProfile,
    onSuccess: () => {
      toast.success('Profile updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Failed to update profile'),
  })

  const updateAccount = useMutation({
    mutationFn: settingsApi.updateAccount,
    onSuccess: () => {
      toast.success('Account updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Failed to update account'),
  })

  const updateAppearance = useMutation({
    mutationFn: settingsApi.updateAppearance,
    onSuccess: () => {
      toast.success('Appearance updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Failed to update appearance'),
  })

  const updateNotifications = useMutation({
    mutationFn: settingsApi.updateNotifications,
    onSuccess: () => {
      toast.success('Notification preferences updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Failed to update notifications'),
  })

  const updateDisplay = useMutation({
    mutationFn: settingsApi.updateDisplay,
    onSuccess: () => {
      toast.success('Display settings updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Failed to update display'),
  })

  return {
    updateProfile,
    updateAccount,
    updateAppearance,
    updateNotifications,
    updateDisplay,
  }
}
