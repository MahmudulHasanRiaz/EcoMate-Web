"use client";

import { useState } from 'react';
import type { SizeChartData } from '../SizeChartModal';
import { SheetShell } from './SheetShell';
import { PLACEHOLDER_IMAGE } from '@/lib/constants';

interface Props {
  chart: SizeChartData;
  onPickSize: (size: string) => void;
  onClose: () => void;
}

type Unit = 'in' | 'cm';

/**
 * Size guide sheet (mockup + guardrail 2a). Table renders the API
 * `tableData` keys as-is (no hardcoded columns). Unit toggle is
 * presentation-only: source values are treated as inches (the local
 * chart convention) and cm is derived client-side (× 2.54, 1 decimal).
 * Non-numeric cells pass through untouched. Data flow
 * `GET /size-charts/by-product/{slug}` is unchanged — this unit only
 * receives the already-fetched chart.
 */
export function toDisplayValue(raw: string, unit: Unit): string {
  if (unit === 'in') return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return (Math.round(n * 2.54 * 10) / 10).toString();
}

const MEASURE_DEFS: { term: string; def: string }[] = [
  { term: 'Chest:', def: 'around the fullest part, under the arms.' },
  { term: 'Length:', def: 'from the highest shoulder point to the hem.' },
  { term: 'Shoulder:', def: 'seam to seam across the back.' },
  { term: 'Sleeve:', def: 'from the shoulder seam to the cuff.' },
];

export function SizeGuideSheet({ chart, onPickSize, onClose }: Props) {
  const [tab, setTab] = useState<'chart' | 'measure'>('chart');
  const [unit, setUnit] = useState<Unit>('in');

  const rows = chart.tableData || [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const sizeKey = columns[0];

  return (
    <SheetShell title={chart.name} onClose={onClose}>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab('chart')}
          className={`h-[32px] px-3 border text-[13px] font-medium rounded-[3px] min-h-[44px] min-[901px]:min-h-0 ${tab === 'chart' ? 'border-brand-blue text-brand-blue' : 'border-brand-border text-gray-700'}`}
        >
          Size chart
        </button>
        <button
          onClick={() => setTab('measure')}
          className={`h-[32px] px-3 border text-[13px] font-medium rounded-[3px] min-h-[44px] min-[901px]:min-h-0 ${tab === 'measure' ? 'border-brand-blue text-brand-blue' : 'border-brand-border text-gray-700'}`}
        >
          How to measure
        </button>
        <div className="ml-auto flex">
          <button
            onClick={() => setUnit('in')}
            aria-pressed={unit === 'in'}
            className={`h-[32px] px-3 border text-[12px] rounded-l-[3px] min-h-[44px] min-[901px]:min-h-0 ${unit === 'in' ? 'bg-brand-dark text-white border-brand-dark' : 'bg-white text-gray-700 border-brand-border'}`}
          >
            Inch
          </button>
          <button
            onClick={() => setUnit('cm')}
            aria-pressed={unit === 'cm'}
            className={`h-[32px] px-3 border text-[12px] rounded-r-[3px] border-l-0 min-h-[44px] min-[901px]:min-h-0 ${unit === 'cm' ? 'bg-brand-dark text-white border-brand-dark' : 'bg-white text-gray-700 border-brand-border'}`}
          >
            Cm
          </button>
        </div>
      </div>

      {tab === 'chart' ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  {columns.map((col) => (
                    <th key={col} className="px-3 py-[10px] text-[11px] font-medium tracking-[0.06em] uppercase text-gray-500 text-left">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col, ci) => (
                      <td key={col} className="px-3 py-[10px] text-[14px] text-brand-dark border-t border-brand-border">
                        {ci === 0 ? (
                          <button
                            onClick={() => { onPickSize(row[col]); onClose(); }}
                            className="font-medium text-brand-blue underline underline-offset-2 min-h-[44px] min-[901px]:min-h-0"
                          >
                            {row[col]}
                          </button>
                        ) : (
                          toDisplayValue(row[col], unit)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-gray-500">Tap a size to select it. Measurements are garment measurements.</p>
        </>
      ) : (
        <div>
          {chart.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chart.image}
              alt={chart.name}
              className="w-full max-h-[400px] object-contain mb-4 rounded-lg"
              onError={(e) => { e.currentTarget.src = PLACEHOLDER_IMAGE; }}
            />
          )}
          <ul className="m-0 p-0 list-none space-y-2">
            {MEASURE_DEFS.map((m) => (
              <li key={m.term} className="text-[14px] text-gray-700">
                <strong className="font-medium">{m.term}</strong> {m.def}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SheetShell>
  );
}
