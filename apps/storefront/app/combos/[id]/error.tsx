'use client';
export default function ComboError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Something went wrong!</h2>
        <p className="text-gray-500 mb-4">{error.message || 'Failed to load combo details.'}</p>
        <button onClick={reset} className="text-brand-blue hover:underline">Try again</button>
      </div>
    </div>
  );
}
