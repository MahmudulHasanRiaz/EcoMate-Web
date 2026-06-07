import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { toast } from 'sonner'
import type { SectionId } from '@/features/settings/storefront/lib/categories'
import { getFieldsInSection } from '@/features/settings/storefront/lib/categories'

export function useStorefrontSettings() {
  const queryClient = useQueryClient()
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const originalRef = useRef<Record<string, string>>({})
  const [lastSavedMap, setLastSavedMap] = useState<Record<string, Date | null>>({})

  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (rawData) {
      const extracted = { ...rawData }
      if (!initialLoadDone.current) {
        setValues(extracted)
        initialLoadDone.current = true
      }
      originalRef.current = extracted
    }
  }, [rawData])

  const setValue = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const setMany = useCallback((updates: Record<string, string>) => {
    setValues(prev => ({ ...prev, ...updates }))
  }, [])

  const isDirty = useCallback((key: string): boolean => {
    return values[key] !== originalRef.current[key]
  }, [values])

  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const key of Object.keys(values)) {
      if (values[key] !== originalRef.current[key]) {
        keys.add(key)
      }
    }
    return keys
  }, [values])

  const isSectionDirty = useCallback((sectionId: SectionId): boolean => {
    const fields = getFieldsInSection(sectionId)
    return fields.some(f => values[f] !== originalRef.current[f])
  }, [values])

  const dirtyKeysInSection = useCallback((sectionId: SectionId): string[] => {
    const fields = getFieldsInSection(sectionId)
    return fields.filter(f => values[f] !== originalRef.current[f])
  }, [values])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      systemSettingsApi.set(key, value),
    onSuccess: (_data, variables) => {
      originalRef.current = {
        ...originalRef.current,
        [variables.key]: values[variables.key],
      }
      setLastSavedMap(prev => ({ ...prev, [variables.key]: new Date() }))
    },
  })

  const saveSection = useCallback(async (sectionId: SectionId) => {
    const changedKeys = dirtyKeysInSection(sectionId)
    if (changedKeys.length === 0) return

    try {
      await Promise.all(
        changedKeys.map(key =>
          setMut.mutateAsync({ key, value: values[key] })
        )
      )
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success('Section saved successfully')
    } catch {
      toast.error('Some settings failed to save. Please retry.')
    }
  }, [dirtyKeysInSection, values, setMut, queryClient])

  const resetSection = useCallback((sectionId: SectionId) => {
    const fields = getFieldsInSection(sectionId)
    setValues(prev => {
      const next = { ...prev }
      for (const field of fields) {
        next[field] = originalRef.current[field] ?? ''
      }
      return next
    })
  }, [])

  const isSaving = setMut.isPending

  return {
    values,
    isLoading,
    setValue,
    setMany,
    isDirty,
    dirtyKeys,
    isSectionDirty,
    dirtyKeysInSection,
    saveSection,
    resetSection,
    isSaving,
    lastSavedMap,
  }
}

export interface UseStorefrontSettingsReturn {
  values: Record<string, string>
  isLoading: boolean
  setValue: (key: string, value: string) => void
  setMany: (updates: Record<string, string>) => void
  isDirty: (key: string) => boolean
  dirtyKeys: Set<string>
  isSectionDirty: (sectionId: SectionId) => boolean
  dirtyKeysInSection: (sectionId: SectionId) => string[]
  saveSection: (sectionId: SectionId) => Promise<void>
  resetSection: (sectionId: SectionId) => void
  isSaving: boolean
  lastSavedMap: Record<string, Date | null>
}
