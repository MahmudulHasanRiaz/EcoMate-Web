import { Suspense } from 'react';
import ArchivePageClient from './ArchivePageClient';

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-pulse space-y-4 w-full max-w-lg px-4"><div className="bg-gray-200 h-64 rounded-lg" /><div className="bg-gray-200 h-6 w-3/4 rounded" /></div></div>}>
      <ArchivePageClient />
    </Suspense>
  );
}
