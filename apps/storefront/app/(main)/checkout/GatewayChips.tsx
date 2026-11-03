// P5 (JS diet): extracted verbatim from checkout/page.tsx (pure code
// organization — no behaviour change). Used by the first-paint payment
// panels in the checkout page and kept as a static import there.

import { PaymentLogo } from '@/components/PaymentLogo';

export function GatewayChips({ gateways }: { gateways: any[] }) {
  const online = gateways.filter(g => g.enabled && g.code !== 'cash').slice(0, 4);
  if (online.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      {online.map(gw => gw.logoUrl ? (
        <img key={gw.id} src={gw.logoUrl} alt={gw.name || gw.code} width={32} height={24} className="h-6 w-8 rounded object-contain" />
      ) : (
        <PaymentLogo key={gw.id} method={gw.code} size="sm" />
      ))}
    </span>
  );
}
