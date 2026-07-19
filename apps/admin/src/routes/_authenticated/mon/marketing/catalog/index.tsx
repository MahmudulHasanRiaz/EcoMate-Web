import { createFileRoute } from '@tanstack/react-router';
import { FeedsPage } from '@/features/feeds';
import { useLicenseStore } from '@/stores/license-store';

function ProductFeedsPage() {
  const loaded = useLicenseStore((s) => s.loaded);
  const hasFeature = useLicenseStore((s) => s.hasFeature);
  const featureAvailable = hasFeature('admin_product_feeds');

  if (!loaded) return null;
  if (!featureAvailable) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Product Catalog Feeds</p>
        <p className="text-sm mt-2">This feature is not available in your current plan.</p>
      </div>
    );
  }
  return <FeedsPage />;
}

export const Route = createFileRoute('/_authenticated/mon/marketing/catalog/')({
  component: ProductFeedsPage,
});
