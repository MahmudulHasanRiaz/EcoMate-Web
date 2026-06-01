"use client";

import { useState, useEffect } from 'react';
import { Gift, ShoppingBag, Minus, Plus, ChevronRight } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { getCombo } from '@/lib/api/combos';
import { useCart } from '@/context/CartContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import type { Combo } from '@/lib/types';

export default function ComboDetailPage() {
  const { config } = useStorefrontConfig();
  const params = useParams();
  const router = useRouter();
  const { items, addToCart, updateQuantity, removeFromCart } = useCart();
  const [combo, setCombo] = useState<Combo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      getCombo(params.id as string).then(setCombo).catch(() => setCombo(null)).finally(() => setLoading(false));
    }
  }, [params.id]);

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

  const savings = combo.originalPrice && combo.originalPrice > combo.price
    ? Math.round(((combo.originalPrice - combo.price) / combo.originalPrice) * 100)
    : 0;

  const comboCartId = `combo-${combo.id}`;
  const cartItem = items.find(item => item.id === comboCartId);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;

  function handleAddToCart() {
    if (!combo) return;
    addToCart({
      id: comboCartId,
      name: combo.name,
      price: combo.price,
      originalPrice: combo.originalPrice,
      image: combo.image || '',
      quantity: 1,
      isCombo: true,
      comboId: combo.id,
      comboItems: combo.items,
    });
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
                <button onClick={() => inCart ? updateQuantity(comboCartId, quantity - 1) : null}
                  className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Minus size={18} /></button>
                <div className="flex-1 border-x border-gray-300 h-full flex items-center justify-center text-[16px] font-medium">{inCart ? quantity : 1}</div>
                <button onClick={() => inCart ? updateQuantity(comboCartId, quantity + 1) : null}
                  className="w-10 h-full flex items-center justify-center text-gray-500 hover:bg-gray-50"><Plus size={18} /></button>
              </div>
            </div>

            <button onClick={inCart ? () => removeFromCart(comboCartId) : handleAddToCart}
              className="w-full h-12 rounded-lg bg-brand-blue hover:bg-brand-blue/90 text-white font-medium flex items-center justify-center gap-2 transition-colors text-sm">
              <ShoppingBag size={18} />
              {inCart ? 'REMOVE FROM CART' : 'ADD COMBO TO CART'}
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
                {combo.items.map((item, i) => (
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
                        <span className="font-medium text-gray-800">{item.productName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-sm">
                      {item.price ? `৳${item.price.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-gray-600">Total Value:</td>
                  <td className="px-4 py-3 text-right">
                    {config.currency.symbol}{combo.originalPrice
                      ? combo.originalPrice.toLocaleString()
                      : combo.items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0).toLocaleString()}
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
