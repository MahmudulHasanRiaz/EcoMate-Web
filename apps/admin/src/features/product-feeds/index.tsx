import { useState } from 'react'
import { Copy, RefreshCw, Eye, EyeOff, Loader2, Plus, ExternalLink } from 'lucide-react'
import { useFeedConfigs, useCreateFeedConfig, useUpdateFeedConfig, useRegenerateToken } from './hooks'
import { useLicenseStore } from '@/stores/license-store'
import { Button } from '@/components/ui/button'

const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta (Facebook)',
  google: 'Google Merchant Center',
  tiktok: 'TikTok',
}

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'https://yourstore.com'

export function ProductFeedsPage() {
  const { data: configs = [], isLoading } = useFeedConfigs()
  const createConfig = useCreateFeedConfig()
  const updateConfig = useUpdateFeedConfig()
  const regenerateToken = useRegenerateToken()
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState<string | null>(null)
  const hasFeature = useLicenseStore((s) => s.hasFeature('admin_product_feeds'))
  const loaded = useLicenseStore((s) => s.loaded)

  if (!loaded) return null
  if (!hasFeature) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Product Catalog Feeds</p>
        <p className="text-sm mt-2">This feature is not available in your current plan.</p>
      </div>
    )
  }

  const platformOrder = ['meta', 'google', 'tiktok']

  const handleCreate = async (platform: string) => {
    setCreating(platform)
    try {
      await createConfig.mutateAsync({ platform })
    } finally {
      setCreating(null)
    }
  }

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token)
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Product Catalog Feeds</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage feeds for Meta, Google Merchant Center, and TikTok
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {platformOrder.map((platform) => {
            const config = configs.find((c) => c.platform === platform)
            const feedUrl = config
              ? `${STOREFRONT_URL}/catalog/v1/${config.secureToken}/${platform}`
              : null

            return (
              <div key={platform} className="rounded-xl border bg-white p-5 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold">{PLATFORM_LABELS[platform] || platform}</h3>
                  {config && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={config.isActive}
                        onChange={(e) =>
                          updateConfig.mutate({ id: config.id, data: { isActive: e.target.checked } })
                        }
                        className="h-4 w-4"
                      />
                      Active
                    </label>
                  )}
                </div>

                {config ? (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Feed URL</p>
                      <div className="flex items-center gap-1">
                        <code className="flex-1 truncate rounded bg-muted p-1.5 text-xs font-mono">
                          {showTokens[platform] ? feedUrl : feedUrl?.replace(config.secureToken, '••••' + config.secureToken.slice(-8))}
                        </code>
                        <button onClick={() => copyToken(config.secureToken)} className="shrink-0 rounded p-1.5 hover:bg-muted" title="Copy token">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setShowTokens((s) => ({ ...s, [platform]: !s[platform] }))} className="shrink-0 rounded p-1.5 hover:bg-muted">
                          {showTokens[platform] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <a href={feedUrl!} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded p-1.5 hover:bg-muted" title="Open feed">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={config.excludeOutOfStock}
                          onChange={(e) =>
                            updateConfig.mutate({ id: config.id, data: { excludeOutOfStock: e.target.checked } })
                          }
                          className="h-3.5 w-3.5"
                        />
                        Exclude out of stock
                      </label>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <button
                        onClick={() => regenerateToken.mutate(config.id)}
                        disabled={regenerateToken.isPending}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Regenerate Token
                      </button>
                    </div>

                    {config.lastFetchedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last fetched: {new Date(config.lastFetchedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <p className="text-sm text-muted-foreground">Not configured</p>
                    <Button
                      size="sm"
                      onClick={() => handleCreate(platform)}
                      disabled={creating === platform}
                    >
                      {creating === platform ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      Create Feed
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
