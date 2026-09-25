import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatBDT, formatPct, type RecognitionStripData } from '../types'
import { HintTooltip, InfoDisclosure, SectionHeader } from './analytics-ui'

/**
 * L1/L2 pipeline honesty strip (§2.1): booked → in-fulfilment → recognised,
 * never mixed. Recognised + Recognition Rate stay prominent; everything else
 * reads subordinate to the KPI band (scaled down, never up). Date-source mix
 * lives behind the info control (+ sr-only audit text), not a caption.
 */
export function RecognitionStrip({ strip }: { strip: RecognitionStripData }) {
  const items: { label: string; value: string; hint?: string; prominent?: boolean }[] = [
    { label: 'Booked', value: `${strip.bookedOrders} · ${formatBDT(strip.bookedAmount)}`, hint: 'Σ Order.total by createdAt — intake only' },
    { label: 'In Fulfilment', value: String(strip.inFulfilment), hint: 'pre-delivery orders' },
    { label: 'Delivered', value: String(strip.delivered) },
    { label: 'Recognised', value: String(strip.recognised), hint: 'the P&L basis', prominent: true },
    { label: 'Not Yet Recognised', value: String(strip.notYetRecognised) },
    { label: 'Recognition Rate', value: formatPct(strip.recognitionRate), prominent: true },
  ]
  const mixSr = `Date sources — timeline: ${strip.dateSourceMix.timeline} · dispatch: ${strip.dateSourceMix.dispatch} · undated deliveries: ${strip.undatedDeliveries}`
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <SectionHeader
          icon={CheckCircle2}
          title="Revenue Recognition"
          tileClassName="bg-success-soft text-success border-success/25"
        />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((i) => (
            <div key={i.label}>
              <p className="-my-1 flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <span>{i.label}</span>
                {i.hint ? <HintTooltip label={`About ${i.label}`} text={i.hint} /> : null}
              </p>
              <p className={cn('tabular-nums', i.prominent ? 'text-lg font-bold' : 'text-base font-semibold')}>
                {i.value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Date sources</span>
          <InfoDisclosure
            label="About date sources"
            lines={[
              `timeline: ${strip.dateSourceMix.timeline} · dispatch: ${strip.dateSourceMix.dispatch}`,
              `undated deliveries: ${strip.undatedDeliveries}`,
            ]}
            contentTestId="strip-date-sources"
          />
          <span className="sr-only" data-testid="strip-date-sources-sr">
            {mixSr}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
