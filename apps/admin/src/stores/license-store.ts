import { create } from 'zustand'

const EVERYTHING_FEATURE = '*'
const PREV_FEATURES_KEY = 'ecomate_previous_features'

function loadPreviousFeatures(): string[] {
  try {
    const raw = localStorage.getItem(PREV_FEATURES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function savePreviousFeatures(features: string[]) {
  try {
    localStorage.setItem(PREV_FEATURES_KEY, JSON.stringify(features.sort()))
  } catch { /* ignore */ }
}

interface LicenseStore {
  features: string[]
  previousFeatures: string[]
  loaded: boolean
  setFeatures: (features: string[]) => { added: string[]; removed: string[] }
  hasFeature: (key: string) => boolean
  clearPreviousFeatures: () => void
}

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  features: [],
  previousFeatures: loadPreviousFeatures(),
  loaded: false,
  setFeatures: (features) => {
    const prev = get().previousFeatures
    const sorted = [...features].sort()
    const prevSorted = [...prev].sort()

    const added = prev.length > 0
      ? features.filter(f => !prevSorted.includes(f))
      : []
    const removed = prev.length > 0
      ? prev.filter(f => !sorted.includes(f))
      : []

    localStorage.setItem('eco_mate_features', JSON.stringify(features))
    savePreviousFeatures(features)
    set({ features, previousFeatures: features, loaded: true })
    return { added, removed }
  },
  hasFeature: (key) => {
    const features = get().features
    return features.includes(EVERYTHING_FEATURE) || features.includes(key)
  },
  clearPreviousFeatures: () => {
    savePreviousFeatures([])
    set({ previousFeatures: [] })
  },
}))
