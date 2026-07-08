import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'

interface LicenseStatusResponse {
  active: boolean
  state: string
  features: string[]
  message: string
  code: string | null
}

interface FeaturesContextType {
  features: string[]
  hasFeature: (key: string) => boolean
  loading: boolean
  error: string | null
}

const FeaturesContext = createContext<FeaturesContextType>({
  features: [],
  hasFeature: () => false,
  loading: true,
  error: null,
})

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<LicenseStatusResponse>('/license/status')
      .then((res) => {
        if (cancelled) return
        setFeatures(res.data.features || [])
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load license status')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const hasFeature = useCallback(
    (key: string) => features.includes(key),
    [features],
  )

  return (
    <FeaturesContext value={{ features, hasFeature, loading, error }}>
      {children}
    </FeaturesContext>
  )
}

export const useFeatures = () => useContext(FeaturesContext)
