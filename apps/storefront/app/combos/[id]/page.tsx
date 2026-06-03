"use client";

import { useState, useEffect, useMemo } from 'react';
import { Gift, ShoppingBag, Minus, Plus, ChevronRight, AlertTriangle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { getCombo } from '@/lib/api/combos';
import { useCart } from '@/context/CartContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Combo, ComboItemDetails, Variant } from '@/lib/types';

interface UniqueAttr {
  name: string;
  attrId: string;
  values: { value: string; variantIds: string[] }[];
}

function getUniqueAttrs(variants: Variant[]): UniqueAttr[] {
  const activeVariants = variants.filter((v) => v.isActive);
  const attrMap = new Map<string, UniqueAttr>();
  for (const v of activeVariants) {
    for (const av of v.attributeValues) {
      const attr = av.attributeValue.attribute;
      const val = av.attributeValue.value;
      if (!attrMap.has(attr.id)) {
        attrMap.set(attr.id, { name: attr.name, attrId: attr.id, values: [] });
      }
      const entry = attrMap.get(attr.id)!;
      const existing = entry.values.find((ev) => ev.value === val);
      if (existing) {
        existing.variantIds.push(v.id);
      } else {
        entry.values.push({ value: val, variantIds: [v.id] });
      }
    }
  }
  return Array.from(attrMap.values());
}

function findVariantByAttrs(variants: Variant[], attrSelections: Record<string, string>): Variant | null {
  const active = variants.filter((v) => v.isActive);
  if (Object.keys(attrSelections).length === 0) return null;
  if (attrSelections['_auto']) {
    return active.find((v) => v.id === attrSelections['_auto']) || null;
  }
  return active.find((v) =>
    Object.entries(attrSelections).every(([attrId, value]) =>
      v.attributeValues.some((av) => av.attributeValue.attribute.id === attrId && av.attributeValue.value === value)
    )
  ) || null;
}

function stableStringify(obj: Record<string, string>): string {
  return JSON.stringify(Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {} as Record<string, string>));
}

function getCartItemKey(comboId: string, selections: Record<string, string>) {
  const base = `combo-${comboId}`;
  const selKeys = Object.keys(selections);
  if (selKeys.length > 0) {
    return `${base}::sel::${stableStringify(selections)}`;
  }
  return base;
}

interface ItemSelections {
  [productId: string]: Record<string, string>;
}

export default function ComboDetailPage() {
  const { config } = useStorefrontConfig();
  const params = useParams();
  const router = useRouter();
  const { items, addToCart, updateQuantity, removeFromCart } = useCart();
  const [combo, setCombo] = useState<Combo | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemSelections, setItemSelections] = useState<ItemSelections>({});

  useEffect(() => {
    if (params.id) {
      getCombo(params.id as string).then((data) => {
        setCombo(data);
        const initial: ItemSelections = {};
        for (const item of data.items) {
          if (item.productType === 'variable' && !item.variantId && item.variants?.length) {
            initial[item.productId] = {};
          }
        }
        setItemSelections(initial);
      }).catch(() => setCombo(null)).finally(() => setLoading(false));
    }
  }, [params.id]);

  const flexibleItems = useMemo(() => {
    if (!combo) return [];
    return combo.items.filter((item) => item.productType === 'variable' && !item.variantId);
  }, [combo]);

  const flexibleItemsWithStock = useMemo(() => {
    return flexibleItems.filter((item) => item.variants?.some((v) => v.isActive && v.stock > 0));
  }, [flexibleItems]);

  const effectiveSelections = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const [productId, attrs] of Object.entries(itemSelections)) {
      const item = combo?.items.find((i) => i.productId === productId);
      if (!item?.variants) continue;
      const variant = findVariantByAttrs(item.variants, attrs);
      if (variant) sel[productId] = variant.id;
    }
    return sel;
  }, [itemSelections, combo]);

  const allFlexibleReady = flexibleItemsWithStock.length === 0 || Object.keys(effectiveSelections).length === flexibleItemsWithStock.length;

  const hasOOSSelection = useMemo(() => {
    if (!combo) return false;
    for (const [productId, variantId] of Object.entries(effectiveSelections)) {
      const item = combo.items.find((i) => i.productId === productId);
      const variant = item?.variants?.find((v) => v.id === variantId);
      if (!variant || variant.stock <= 0) return true;
    }
    return false;
  }, [effectiveSelections, combo]);

  function handleAttrChange(productId: string, attrId: string, value: string) {
    setItemSelections((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), [attrId]: value },
    }));
  }

  function renderVariantSelector(item: ComboItemDetails) {
    if (!item.variants?.length) return null;
    const activeVariants = item.variants.filter((v) => v.isActive);
    const inStockVariants = activeVariants.filter((v) => v.stock > 0);
    const hasInStockOption = inStockVariants.length > 0;

    if (activeVariants.length === 0) {
      return (
        <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle size={12} />No variants available for this product
        </div>
      );
    }

    if (!hasInStockOption) {
      return (
        <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle size={12} />All variants are out of stock
        </div>
      );
    }

    const displayVariants = inStockVariants;
    const uniqueAttrs = getUniqueAttrs(displayVariants);
    const currentSelections = itemSelections[item.productId] || {};
    const selectedVariant = findVariantByAttrs(displayVariants, currentSelections);
    const hasAttrs = uniqueAttrs.length > 0;

    if (!hasAttrs && displayVariants.length === 1) {
      return (
        <div className="mt-2">
          <button
            onClick={() => handleAttrChange(item.productId, '_auto', displayVariants[0].id)}
            className="text-xs text-brand-blue font-medium hover:underline"
          >
            Select ({displayVariants[0].sku || config.currency.symbol + displayVariants[0].price.toLocaleString()})
          </button>
          {selectedVariant && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
              <span className="text-green-600 font-medium">Selected:</span>
              <span>{config.currency.symbol}{selectedVariant.price.toLocaleString()}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mt-2 space-y-2">
        {uniqueAttrs.map((attr) => {
          const attrsSoFar = { ...currentSelections };
          delete attrsSoFar[attr.attrId];
          const matchedVariantIds = new Set(
            (Object.keys(attrsSoFar).length > 0
              ? displayVariants.filter((v) =>
                  Object.entries(attrsSoFar).every(([aid, aval]) =>
                    v.attributeValues.some((avv) => avv.attributeValue.attribute.id === aid && avv.attributeValue.value === aval)
                  )
                )
              : displayVariants
            ).map((v) => v.id)
          );
          const availableValues = attr.values.filter((v) =>
            v.variantIds.some((vid) => matchedVariantIds.has(vid))
          );

          return (
            <div key={attr.attrId} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-16 shrink-0">{attr.name}:</span>
              <div className="flex flex-wrap gap-1.5">
                {availableValues.map((v) => {
                  const isSelected = currentSelections[attr.attrId] === v.value;
                  return (
                    <button
                      key={v.value}
                      onClick={() => handleAttrChange(item.productId, attr.attrId, v.value)}
                      className={`min-w-[32px] h-8 px-2.5 text-xs font-medium rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-brand-blue text-white border-brand-blue'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-brand-blue hover:text-brand-blue'
                      }`}
                    >
                      {v.value}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {selectedVariant && (
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
            <span className="text-green-600 font-medium">Selected:</span>
            <span>{config.currency.symbol}{selectedVariant.price.toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  }

  const savings = combo?.originalPrice && combo.originalPrice > combo.price
    ? Math.round(((combo.originalPrice - combo.price) / combo.originalPrice) * 100)
    : 0;

  const comboCartKey = combo ? getCartItemKey(combo.id, effectiveSelections) : '';
  const cartItem = combo ? items.find((item) => getCartItemKey(combo.id, item.comboSelections || {}) === comboCartKey) : null;
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;

  function handleAddToCart() {
    if (!combo || !allFlexibleReady || hasOOSSelection) return;
    addToCart({
      id: comboCartKey,
      name: combo.name,
      price: combo.price,
      originalPrice: combo.originalPrice,
      image: combo.image || '',
      quantity: 1,
      isCombo: true,
      comboId: combo.id,
      comboItems: combo.items,
      comboSelections: effectiveSelections,
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse space-y-4 w-full max-w-lg px-4">
          <div className="bg-gray-200 h-64 rounded-xl" />
          <div className="bg-gray-200 h-6 w-3/4 rounded" />
          <div className="bg-gray-200 h-4 w-1/2 rounded" />
        </div>
      </div>
    );
  }

  if (!combo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Gift className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg mb-2">Combo not found</p>
          <button onClick={() => router.push('/combos')} className="text-brand-blue hover:underline">View All Combos</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen pb-24">
      <div className="px-4 py-3 flex items-center gap-2 text-[14px]">
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-800">Home</button>
        <ChevronRight size={14} className="text-gray-400" />
        <button onClick={() => router.push('/combos')} className="text-gray-500 hover:text-gray-800">Combos</button>
        <ChevronRight size={14} className="text-gray-400" />
        <span className="text-gray-800 truncate">{combo.name}</span>
      </div>

      <div className="max-w-5xl mx-auto px-4">
        <div className="flex flex-col md:flex-row gap-8 mb-8">
          <div className="md:w-1/2">
            <div className="bg-gray-50 rounded-xl overflow-hidden relative">
              {combo.image ? (
                <img src={combo.image} alt={combo.name} className="w-full h-72 md:h-96 object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }} />
              ) : (
                <div className="w-full h-72 md:h-96 flex items-center justify-center"><Gift className="w-20 h-20 text-gray-300" /></div>
              )}
              {savings > 0 && (
                <div className="absolute top-4 left-4 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full">Save {savings}%</div>
              )}
            </div>
          </div>

          <div className="md:w-1/2 flex flex-col justify-center">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-3">{combo.name}</h1>
            {combo.shortDesc && <p className="text-gray-500 mb-4">{combo.shortDesc}</p>}

            <div className="flex items-baseline gap-3 mb-6">
              <span className="text-3xl font-bold text-brand-blue">{config.currency.symbol}{combo.price.toLocaleString()}</span>
              {combo.originalPrice && combo.originalPrice > combo.price && (
                <span className="text-gray-400 line-through text-lg">{config.currency.symbol}{combo.originalPrice.toLocaleString()}</span>
              )}
            </div>

            <div className="flex items-center gap-6 mb-6">
              <span className="text-gray-700">Quantity:</span>
              <div className="flex items-center h-[38px] border border-gray-300 rounded-md overflow-hidden bg-white w-[130px]">
                <button onClick={() => inCart ? updateQuantity(comboCartKey, quantity - 1) : null}
                  className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Minus size={18} /></button>
                <div className="flex-1 border-x border-gray-300 h-full flex items-center justify-center text-[16px] font-medium">{inCart ? quantity : 1}</div>
                <button onClick={() => inCart ? updateQuantity(comboCartKey, quantity + 1) : null}
                  className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Plus size={18} /></button>
              </div>
            </div>

            <button
              onClick={inCart ? () => removeFromCart(comboCartKey) : handleAddToCart}
              disabled={!inCart && (!allFlexibleReady || hasOOSSelection)}
              className={`w-full h-12 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm ${
                inCart
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : !allFlexibleReady
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : hasOOSSelection
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-brand-blue hover:bg-brand-blue/90 text-white'
              }`}
            >
              <ShoppingBag size={18} />
              {inCart ? 'REMOVE FROM CART' : !allFlexibleReady ? 'SELECT VARIANT(S)' : hasOOSSelection ? 'OUT OF STOCK' : 'ADD COMBO TO CART'}
            </button>
          </div>
        </div>

        {combo.description && (
          <div className="mb-8">
            <h3 className="text-lg font-bold text-gray-800 mb-3">Description</h3>
            <p className="text-gray-600 leading-relaxed">{combo.description}</p>
          </div>
        )}

        <div className="mb-12">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Items in this Combo</h3>
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">#</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Product</th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">Qty</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {combo.items.map((item, i) => {
                  const isFlexible = item.productType === 'variable' && !item.variantId;
                  const selectedVariant = isFlexible
                    ? findVariantByAttrs(item.variants || [], itemSelections[item.productId] || {})
                    : null;
                  const displayPrice = isFlexible
                    ? (selectedVariant ? selectedVariant.price : undefined)
                    : item.price;

                  return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.productImage ? (
                          <img src={item.productImage} alt="" className="w-10 h-10 rounded object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }} />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
                            <Gift size={18} className="text-gray-300" />
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-gray-800">{item.productName}</span>
                          {isFlexible && renderVariantSelector(item)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-sm">
                      {displayPrice ? `${config.currency.symbol}${displayPrice.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-gray-600">Total Value:</td>
                  <td className="px-4 py-3 text-right">
                    {config.currency.symbol}{combo.originalPrice
                      ? combo.originalPrice.toLocaleString()
                      : combo.items.reduce((s, i) => {
                          const isFlex = i.productType === 'variable' && !i.variantId;
                          const sv = isFlex ? findVariantByAttrs(i.variants || [], itemSelections[i.productId] || {}) : null;
                          const p = isFlex ? (sv ? sv.price : undefined) : i.price;
                          return s + (p || 0) * i.quantity;
                        }, 0).toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-brand-blue">Combo Price:</td>
                  <td className="px-4 py-3 text-right text-brand-blue font-bold">{config.currency.symbol}{combo.price.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
