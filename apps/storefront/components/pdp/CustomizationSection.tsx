"use client";

import { Check } from 'lucide-react';
import type {
  CustomizationSelection,
  PublicCustomizationGroup,
} from '@/lib/customization';
import { selectionAddon } from '@/lib/customization';

/**
 * PDP customization section (owner Q15: storefront presentation is a
 * designed part of the feature, not an afterthought). Pill choices for
 * single/multi groups with visible +price chips, a counted text field
 * for text groups, and a live add-on total for the chosen quantity.
 * Theme colors only (brand tokens) — no hardcoded chrome hex.
 */
export function CustomizationSection({
  definition,
  selection,
  onChange,
  qty,
  currencySymbol,
}: {
  definition: PublicCustomizationGroup[];
  selection: CustomizationSelection | undefined;
  onChange: (next: CustomizationSelection) => void;
  qty: number;
  currencySymbol: string;
}) {
  const answerOf = (key: string) => selection?.groups.find((g) => g.key === key);
  const setAnswer = (key: string, patch: { optionKeys?: string[]; text?: string }) => {
    const rest = (selection?.groups || []).filter((g) => g.key !== key);
    onChange({ groups: [...rest, { key, ...patch }] });
  };
  const { perUnit, perLine } = selectionAddon(definition, selection);
  const addonForQty = perUnit * qty + perLine;
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  if (definition.length === 0) return null;

  return (
    <div className="mb-4 rounded-[4px] border border-brand-border bg-white p-3.5" data-testid="customization-section">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-brand-dark">Make it yours</span>
        {addonForQty > 0 && (
          <span className="text-[12px] font-medium text-brand-blue">
            Add-ons: +{currencySymbol}{fmt(addonForQty)}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {definition.map((g) => {
          const ans = answerOf(g.key);
          return (
            <div key={g.key}>
              <div className="mb-2 text-[13px] text-gray-700 font-medium">
                {g.label}
                {g.type === 'text' && (g.priceDelta ?? 0) > 0 && (
                  <span className="text-gray-500 font-normal"> (+{currencySymbol}{fmt(g.priceDelta ?? 0)})</span>
                )}
              </div>

              {g.type === 'text' ? (
                <div>
                  <input
                    type="text"
                    value={ans?.text || ''}
                    maxLength={g.maxLength}
                    onChange={(e) => setAnswer(g.key, { text: e.target.value })}
                    placeholder={g.label}
                    className="h-11 w-full rounded-[3px] border border-brand-border bg-white px-3 text-[14px] outline-none focus:border-brand-blue"
                  />
                  {g.maxLength ? (
                    <div className="mt-1 text-right text-[11px] text-gray-400">
                      {(ans?.text || '').length}/{g.maxLength}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(g.options || []).map((o) => {
                    const selected = (ans?.optionKeys || []).includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => {
                          if (g.type === 'single') {
                            // Add-ons are always optional: tapping the chosen
                            // option again deselects it (back to plain).
                            setAnswer(g.key, { optionKeys: selected ? [] : [o.key] });
                          } else {
                            const cur = ans?.optionKeys || [];
                            setAnswer(g.key, {
                              optionKeys: selected
                                ? cur.filter((k) => k !== o.key)
                                : [...cur, o.key],
                            });
                          }
                        }}
                        className={`flex min-h-[40px] items-center gap-1.5 rounded-[3px] border px-3 py-2 text-[13px] transition-colors ${
                          selected
                            ? 'border-brand-blue bg-brand-blue/5 font-medium text-brand-dark'
                            : 'border-brand-border bg-white text-gray-700 hover:border-brand-blue/60'
                        }`}
                        aria-pressed={selected}
                      >
                        {selected && <Check size={14} className="text-brand-blue" />}
                        {o.label}
                        {o.priceDelta > 0 && (
                          <span className={selected ? 'text-brand-blue' : 'text-gray-500'}>
                            +{currencySymbol}{fmt(o.priceDelta)}
                            {o.pricingKind === 'per_line' ? ' /order' : ''}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
