import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { systemSettingsApi } from '@/features/settings/storage-api';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLicenseStore } from '@/stores/license-store';
import {
  Smartphone,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Clock,
  Play,
  CheckCheck,
  Store,
  Save,
} from 'lucide-react';

interface ReadyStatus {
  ready: boolean;
  missing: string[];
  summary: {
    license: boolean;
    branding: boolean;
    domain: boolean;
    packageId: boolean;
  };
}

interface Metadata {
  clientDomain: string;
  appName: string;
  packageId: string;
  bundleId: string;
  versionName: string;
  versionCode: number;
}

interface BuildRecord {
  id: string;
  app: string;
  platform: string;
  status: 'queued' | 'running' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  versionName: string;
  errorMessage?: string;
  artifactPath?: string;
  buildLogUrl?: string;
  createdAt: string;
  updatedAt: string;
}

const APPS = ['storefront', 'admin', 'pos'] as const;
const PLATFORMS = ['android', 'ios'] as const;

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  running: { label: 'Running', variant: 'default' },
  uploading: { label: 'Uploading', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  completed: { label: 'Completed', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export function MobileSettings() {
  const queryClient = useQueryClient();
  const hasFeature = useLicenseStore((s) => s.hasFeature);
  const [selectedApp, setSelectedApp] = useState<string>('storefront');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('android');

  const { data: ready, isLoading: readyLoading } = useQuery<ReadyStatus>({
    queryKey: ['mobile-builder-ready'],
    queryFn: () => apiClient.get('/mobile-builder/ready').then((r) => r.data),
    retry: false,
  });

  const { data: metadata } = useQuery<Metadata>({
    queryKey: ['mobile-builder-metadata'],
    queryFn: () => apiClient.get('/mobile-builder/metadata').then((r) => r.data),
    retry: false,
    enabled: ready?.ready === true,
  });

  const { data: builds } = useQuery<BuildRecord[]>({
    queryKey: ['mobile-builder-builds'],
    queryFn: () => apiClient.get('/mobile-builder/builds').then((r) => r.data),
    retry: false,
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/mobile-builder/publish', { app: selectedApp, platform: selectedPlatform }).then((r) => r.data),
    onSuccess: (res: any) => {
      toast.success(`Build published! ID: ${res.buildId}`);
      queryClient.invalidateQueries({ queryKey: ['mobile-builder-builds'] });
      queryClient.invalidateQueries({ queryKey: ['mobile-builder-ready'] });
    },
    onError: (err: any) => {
      toast.error(`Publish failed: ${err.message || 'Unknown error'}`);
    },
  });

  const isLicensed = hasFeature('mobile_distribution');

  // Play Store / App Store URL state
  const { data: allSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
    staleTime: 30_000,
  });
  // Generic store URLs (fallback)
  const [playStoreUrl, setPlayStoreUrl] = useState('');
  const [appStoreUrl, setAppStoreUrl] = useState('');
  // Per-app store URLs
  const [sfPlayStore, setSfPlayStore] = useState('');
  const [sfAppStore, setSfAppStore] = useState('');
  const [adPlayStore, setAdPlayStore] = useState('');
  const [adAppStore, setAdAppStore] = useState('');
  const [posPlayStore, setPosPlayStore] = useState('');
  const [posAppStore, setPosAppStore] = useState('');

  useEffect(() => {
    if (allSettings) {
      setPlayStoreUrl(allSettings.play_store_url || '');
      setAppStoreUrl(allSettings.app_store_url || '');
      setSfPlayStore(allSettings.storefront_play_store_url || '');
      setSfAppStore(allSettings.storefront_app_store_url || '');
      setAdPlayStore(allSettings.admin_play_store_url || '');
      setAdAppStore(allSettings.admin_app_store_url || '');
      setPosPlayStore(allSettings.pos_play_store_url || '');
      setPosAppStore(allSettings.pos_app_store_url || '');
    }
  }, [allSettings]);

  const saveUrlMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      toast.success('Store URL saved');
    },
    onError: (err: any) => toast.error(`Failed to save: ${err.message}`),
  });

  if (!isLicensed) {
    return (
      <div className='space-y-6 w-full'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Publish Mobile App</h2>
          <p className='text-muted-foreground'>Generate native mobile applications for storefront, admin panel, and POS.</p>
        </div>
        <Separator />
        <Card>
          <CardContent className='flex flex-col items-center justify-center py-12 text-center'>
            <Smartphone className='h-12 w-12 text-muted-foreground/50 mb-4' />
            <h3 className='text-lg font-semibold mb-2'>Mobile Distribution Not Available</h3>
            <p className='text-muted-foreground max-w-md'>
              Your current license does not include mobile distribution. Upgrade to publish Android and iOS apps.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className='space-y-6 w-full'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Publish Mobile App</h2>
        <p className='text-muted-foreground'>Generate native mobile apps for your storefront, admin panel, and POS terminal.</p>
      </div>
      <Separator />

      {/* Pre-flight Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <CheckCheck className='h-5 w-5' />
            Pre-flight Checklist
          </CardTitle>
          <CardDescription>All checks must pass before publishing.</CardDescription>
        </CardHeader>
        <CardContent>
          {readyLoading ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='animate-spin h-4 w-4' /> Checking...
            </div>
          ) : (
            <div className='grid gap-3 sm:grid-cols-2'>
              {[
                { key: 'license', label: 'License', ok: ready?.summary?.license },
                { key: 'branding', label: 'Branding (name + logo + color)', ok: ready?.summary?.branding },
                { key: 'domain', label: 'Domain (CLIENT_DOMAIN)', ok: ready?.summary?.domain },
                { key: 'packageId', label: 'Package ID', ok: ready?.summary?.packageId },
              ].map((check) => (
                <div key={check.key} className='flex items-center justify-between p-3 bg-muted/50 rounded-lg'>
                  <span className='text-sm'>{check.label}</span>
                  {check.ok ? (
                    <CheckCircle2 className='h-5 w-5 text-green-500 shrink-0' />
                  ) : (
                    <XCircle className='h-5 w-5 text-red-400 shrink-0' />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Publish Wizard */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Play className='h-5 w-5' />
            Publish
          </CardTitle>
          <CardDescription>Select app and platform, then publish.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* App Selection */}
          <div>
            <p className='text-sm font-medium mb-3'>Application</p>
            <div className='flex flex-wrap gap-2'>
              {APPS.map((app) => {
                const featureKey = `mobile_distribution${app === 'storefront' ? '' : '_' + app}`;
                const licensed = hasFeature(featureKey);
                return (
                  <Button
                    key={app}
                    variant={selectedApp === app ? 'default' : 'outline'}
                    size='sm'
                    disabled={!licensed}
                    onClick={() => setSelectedApp(app)}
                  >
                    {app.charAt(0).toUpperCase() + app.slice(1)}
                    {!licensed && <XCircle className='h-3 w-3 ml-2' />}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Platform Selection */}
          <div>
            <p className='text-sm font-medium mb-3'>Platform</p>
            <div className='flex flex-wrap gap-2'>
              {PLATFORMS.map((p) => (
                <Button
                  key={p}
                  variant={selectedPlatform === p ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setSelectedPlatform(p)}
                >
                  {p === 'android' ? 'Android' : 'iOS'}
                </Button>
              ))}
            </div>
          </div>

          {/* Publish Button */}
          <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed'>
            <div className='text-sm text-muted-foreground'>
              {ready?.ready
                ? `Ready to publish ${selectedApp} for ${selectedPlatform}.`
                : 'Complete the checklist above to enable publishing.'}
            </div>
            <Button
              size='lg'
              disabled={!ready?.ready || publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
              className='px-8'
            >
              {publishMutation.isPending ? (
                <Loader2 className='animate-spin h-4 w-4 mr-2' />
              ) : (
                <Smartphone className='h-4 w-4 mr-2' />
              )}
              Publish {selectedApp}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Store Listing URLs */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Store className='h-5 w-5' />
            Store Listing URLs
          </CardTitle>
          <CardDescription>
            Configure per-app store links. When set, the download page will redirect to the store instead of serving direct APK/IPA. Leave blank to use the generic fallback or direct download.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {[
            { label: 'Generic (fallback)', fields: [
              { id: 'play-store-url', key: 'play_store_url', val: playStoreUrl, set: setPlayStoreUrl },
              { id: 'app-store-url', key: 'app_store_url', val: appStoreUrl, set: setAppStoreUrl },
            ]},
            { label: 'Storefront App', fields: [
              { id: 'sf-play-store', key: 'storefront_play_store_url', val: sfPlayStore, set: setSfPlayStore },
              { id: 'sf-app-store', key: 'storefront_app_store_url', val: sfAppStore, set: setSfAppStore },
            ]},
            { label: 'Admin App', fields: [
              { id: 'ad-play-store', key: 'admin_play_store_url', val: adPlayStore, set: setAdPlayStore },
              { id: 'ad-app-store', key: 'admin_app_store_url', val: adAppStore, set: setAdAppStore },
            ]},
            { label: 'POS App', fields: [
              { id: 'pos-play-store', key: 'pos_play_store_url', val: posPlayStore, set: setPosPlayStore },
              { id: 'pos-app-store', key: 'pos_app_store_url', val: posAppStore, set: setPosAppStore },
            ]},
          ].map((group) => (
            <div key={group.label}>
              <p className='text-sm font-medium mb-2'>{group.label}</p>
              <div className='grid gap-3 md:grid-cols-2'>
                {group.fields.map((f) => (
                  <div key={f.id} className='flex gap-2 items-end'>
                    <div className='flex-1 space-y-1'>
                      <Label htmlFor={f.id} className='text-xs text-muted-foreground'>
                        {f.id.includes('play') ? 'Google Play URL' : 'Apple App Store URL'}
                      </Label>
                      <Input
                        id={f.id}
                        value={f.val}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.id.includes('play') ? 'https://play.google.com/...' : 'https://apps.apple.com/...'}
                      />
                    </div>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={saveUrlMutation.isPending}
                      onClick={() => saveUrlMutation.mutate({ key: f.key, value: f.val })}
                    >
                      <Save className='h-4 w-4' />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Build History */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Clock className='h-5 w-5' />
            Build History
          </CardTitle>
          <CardDescription>Recent build records.</CardDescription>
        </CardHeader>
        <CardContent>
          {!builds || builds.length === 0 ? (
            <div className='text-center py-8 text-sm text-muted-foreground'>
              No builds yet. Publish your first mobile app above.
            </div>
          ) : (
            <div className='space-y-2'>
              {builds.slice(0, 10).map((build) => {
                const badge = STATUS_BADGE[build.status] || STATUS_BADGE.queued;
                return (
                  <div key={build.id} className='flex items-center justify-between p-3 border rounded-lg text-sm'>
                    <div className='flex items-center gap-3'>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <span className='font-medium capitalize'>{build.app}</span>
                      <span className='text-muted-foreground'>{build.platform}</span>
                      <span className='text-xs text-muted-foreground font-mono'>v{build.versionName}</span>
                    </div>
                    <div className='flex items-center gap-2'>
                      {build.status === 'completed' && (
                        <Button variant='ghost' size='sm' asChild>
                          <a href={build.artifactPath || '#'} target='_blank' rel='noreferrer'>
                            <Download className='h-4 w-4' />
                          </a>
                        </Button>
                      )}
                      <span className='text-xs text-muted-foreground'>
                        {new Date(build.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
