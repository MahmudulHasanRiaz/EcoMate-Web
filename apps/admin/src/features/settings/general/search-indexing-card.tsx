import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { toast } from 'sonner'
import { Globe, Loader2 } from 'lucide-react'

/**
 * Search-engine indexing toggle (D7). One flag drives robots.txt +
 * sitemap.xml + storefront meta in lockstep:
 * - ON: robots allow crawling, sitemap populated, pages indexable.
 * - OFF: robots `Disallow: /`, empty sitemap, `noindex, nofollow`.
 * New tenants default OFF (seeder); existing tenants were backfilled ON
 * by migration 20261113160000. Nothing in the app ever turns it on
 * automatically — only this switch does.
 */
export function SearchIndexingCard() {
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then((r) => r.data as Record<string, string>),
    staleTime: 30_000,
  })

  // A missing key means a pre-toggle backend: keep the historic ON
  // behaviour visible rather than showing a wrong OFF.
  const enabled = settings ? settings['search_engine_indexing'] !== 'false' : true

  const saveMut = useMutation({
    mutationFn: (value: boolean) =>
      systemSettingsApi.set('search_engine_indexing', value ? 'true' : 'false'),
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success(
        value
          ? 'Search indexing turned on — robots and sitemap will allow crawling.'
          : 'Search indexing turned off — robots will disallow crawling and the sitemap will be empty.',
      )
    },
    onError: () => toast.error('Failed to save search indexing setting'),
    onSettled: () => setIsSaving(false),
  })

  const handleToggle = (checked: boolean) => {
    setIsSaving(true)
    saveMut.mutate(checked)
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <Globe size={20} className='text-primary' />
            <div>
              <CardTitle>Search Engine Indexing</CardTitle>
              <CardDescription>
                Controls whether search engines may crawl and index the storefront.
              </CardDescription>
            </div>
          </div>
          {isLoading ? (
            <Loader2 className='animate-spin h-5 w-5 text-muted-foreground' />
          ) : (
            <Badge variant={enabled ? 'default' : 'secondary'}>
              {enabled ? 'Indexed' : 'Not indexed'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center justify-between gap-4'>
          <div className='text-sm'>
            <p className='font-medium'>Allow search engines to index the store</p>
            <p className='text-muted-foreground'>
              {enabled
                ? 'On — robots.txt allows crawling, the sitemap lists public pages, and pages are indexable.'
                : 'Off — robots.txt disallows all crawling, the sitemap is empty, and pages carry noindex. Turn this on only when the store data is production-ready.'}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || isSaving}
            aria-label='Allow search engines to index the store'
          />
        </div>
        <p className='text-xs text-muted-foreground'>
          Admin, login, account and checkout pages are always excluded from indexing, regardless of this setting.
          Pages with no configured content are also excluded automatically.
        </p>
      </CardContent>
    </Card>
  )
}
