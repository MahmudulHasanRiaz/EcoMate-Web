import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBDT, formatPct, type RecognitionStripData } from '../types'

/** L1/L2 pipeline honesty strip (§2.1): booked → in-fulfilment → recognised, never mixed. */
export function RecognitionStrip({ strip }: { strip: RecognitionStripData }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: 'Booked', value: `${strip.bookedOrders} · ${formatBDT(strip.bookedAmount)}`, hint: 'Σ Order.total by createdAt — intake only' },
    { label: 'In Fulfilment', value: String(strip.inFulfilment), hint: 'pre-delivery orders' },
    { label: 'Delivered', value: String(strip.delivered) },
    { label: 'Recognised', value: String(strip.recognised), hint: 'the P&L basis' },
    { label: 'Not Yet Recognised', value: String(strip.notYetRecognised) },
    { label: 'Recognition Rate', value: formatPct(strip.recognitionRate) },
  ]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Revenue Recognition</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {items.map((i) => (
            <div key={i.label} title={i.hint}>
              <p className="text-[11px] text-muted-foreground">{i.label}</p>
              <p className="text-lg font-bold">{i.value}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Date sources — timeline: {strip.dateSourceMix.timeline} · dispatch: {strip.dateSourceMix.dispatch} · undated deliveries: {strip.undatedDeliveries}
        </p>
      </CardContent>
    </Card>
  )
}
