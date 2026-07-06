import { create } from 'zustand'

interface LicenseStore {
  features: string[]
  loaded: boolean
  setFeatures: (features: string[]) => void
  hasFeature: (key: string) => boolean
}

const EVERYTHING_FEATURE = '*'

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  features: [],
  loaded: false,
  setFeatures: (features) => set({ features, loaded: true }),
  hasFeature: (key) => {
    const features = get().features
    return features.includes(EVERYTHING_FEATURE) || features.includes(key)
  },
}))
