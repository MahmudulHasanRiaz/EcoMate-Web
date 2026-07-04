import { create } from 'zustand'

interface LicenseStore {
  features: string[]
  loaded: boolean
  setFeatures: (features: string[]) => void
  hasFeature: (key: string) => boolean
}

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  features: [],
  loaded: false,
  setFeatures: (features) => set({ features, loaded: true }),
  hasFeature: (key) => get().features.includes(key),
}))
