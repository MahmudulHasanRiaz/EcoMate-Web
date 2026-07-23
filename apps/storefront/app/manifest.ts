import type { MetadataRoute } from 'next'
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  try {
    const config = await getStorefrontConfigServer()
    let faviconUrl = config.branding?.storefrontFavicon || '/favicon.svg'
    const primaryColor = config.branding?.colors?.primary || '#0089CD'
    const faviconPngUrl = faviconUrl.replace(/\.svg$/, '.png')
    return {
      name: config.store.name || 'Store',
      short_name: config.store.name || 'Store',
      description: config.seo.description || '',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: primaryColor,
      icons: [
        { src: faviconUrl, sizes: 'any', type: 'image/svg+xml' },
        { src: faviconPngUrl, sizes: '192x192', type: 'image/png' },
        { src: faviconPngUrl, sizes: '512x512', type: 'image/png' },
        { src: faviconPngUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
        { src: '/favicon.png', sizes: '192x192', type: 'image/png' },
        { src: '/favicon.png', sizes: '512x512', type: 'image/png' },
        { src: '/favicon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
  }
}
