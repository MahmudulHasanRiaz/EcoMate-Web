import { Suspense } from 'react';
import ThankYouContent from './ThankYouContent';

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div className="bg-[#f2f4f8] min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse space-y-4 w-full max-w-md">
          <div className="bg-gray-200 h-8 w-3/4 mx-auto rounded" />
          <div className="bg-gray-200 h-4 w-1/2 mx-auto rounded" />
          <div className="bg-gray-200 h-64 rounded-xl" />
        </div>
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  );
}
