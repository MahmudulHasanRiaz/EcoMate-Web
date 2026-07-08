import { create } from 'zustand'

const EVERYTHING_FEATURE = '*'
const PREV_FEATURES_KEY = 'ecomate_previous_features'
const FEATURES_CACHE_KEY = 'eco_mate_features'

function loadFromStorage(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(key: string, features: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(features.sort()))
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
  features: loadFromStorage(FEATURES_CACHE_KEY),
  previousFeatures: loadFromStorage(PREV_FEATURES_KEY),
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

    saveToStorage(FEATURES_CACHE_KEY, features)
    saveToStorage(PREV_FEATURES_KEY, features)
    set({ features, previousFeatures: features, loaded: true })
    return { added, removed }
  },
  hasFeature: (key) => {
    const features = get().features
    return features.includes(EVERYTHING_FEATURE) || features.includes(key)
  },
  clearPreviousFeatures: () => {
    saveToStorage(PREV_FEATURES_KEY, [])
    set({ previousFeatures: [] })
  },
}))
