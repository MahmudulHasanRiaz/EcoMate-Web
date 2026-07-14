import type { MetadataRoute } from 'next'
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  try {
    const config = await getStorefrontConfigServer()
    const faviconUrl = config.branding?.storefrontFavicon || '/favicon.svg'
    return {
      name: config.store.name || 'Store',
      short_name: config.store.name || 'Store',
      description: config.seo.description || '',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: config.branding?.colors?.primary || '#0089CD',
      icons: [
        { src: faviconUrl, sizes: 'any', type: 'image/svg+xml' },
      ],
    }
  } catch {
    return {
      name: 'Store',
      short_name: 'Store',
      description: '',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0089CD',
      icons: [
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    }
  }
}
