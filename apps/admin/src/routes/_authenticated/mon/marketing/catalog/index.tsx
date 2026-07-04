import { createFileRoute } from '@tanstack/react-router';
import { FeedsPage } from '@/features/feeds';
import { useLicenseStore } from '@/stores/license-store';

function ProductFeedsPage() {
  const hasFeature = useLicenseStore((s) => s.hasFeature);
  if (!hasFeature('admin_product_feeds')) return null;
  return <FeedsPage />;
}

export const Route = createFileRoute('/_authenticated/mon/marketing/catalog/')({
  component: ProductFeedsPage,
});
