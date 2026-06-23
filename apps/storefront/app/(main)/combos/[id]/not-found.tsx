import Link from 'next/link';
export default function ComboNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Combo Not Found</h2>
        <p className="text-gray-500 mb-4">This combo deal doesn&apos;t exist or has been removed.</p>
        <Link href="/combos" className="text-brand-blue hover:underline">View All Combos</Link>
      </div>
    </div>
  );
}
