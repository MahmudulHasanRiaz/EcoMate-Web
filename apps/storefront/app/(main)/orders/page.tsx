"use client";

import React, { useState } from 'react';
import {
  Search,
  Package,
  Truck,
  Check,
  MapPin,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  User,
  Phone,
  Headphones,
  Clock,
  Sparkles,
  ChevronDown,
  XCircle,
  ShoppingBag,
  CheckCircle2,
  Boxes,
  Home
} from 'lucide-react';
import Image from 'next/image';
import apiClient from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';

interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  product: { name: string; slug: string; images: string[] };
}

interface ShippingAddress {
  // The public tracking DTO is deliberately no-PII: only city/district
  // ever reach this page, so no other field is read from the address.
  city?: string | null;
  district?: string | null;
}

interface TimelineEntry {
  status: string;
  timestamp: string;
  note?: string;
}

interface OrderData {
  id: string;
  displayId: string;
  status: { name: string; color?: string } | null;
  createdAt: string;
  items: OrderItem[];
  shippingAddress: ShippingAddress | null;
  trackingUrl: string | null;
  shipment: { courier: string | null; trackingCode: string | null } | null;
  timeline: TimelineEntry[];
  total: number;
  customer?: { name?: string | null; phone?: string | null } | null;
  guestName?: string | null;
  guestPhone?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerPhone?: string | null;
}

// Predefined canonical tracking journey stages, mirroring the order
// statuses that exist in the database.
export interface JourneyStageConfig {
  key: string;
  label: string;
  description: string;
}

export const JOURNEY_STAGES: JourneyStageConfig[] = [
  { key: 'placed', label: 'Order Placed', description: 'Order successfully created' },
  { key: 'confirmed', label: 'Confirmed', description: 'Order confirmed and verified' },
  { key: 'packed', label: 'Packed', description: 'Items boxed and ready for courier' },
  { key: 'shipping', label: 'Shipping', description: 'Handed over to courier and in transit' },
  { key: 'delivered', label: 'Delivered', description: 'Package safely delivered' },
];

export function getStageIcon(key: string) {
  switch (key) {
    case 'placed': return ShoppingBag;
    case 'confirmed': return CheckCircle2;
    case 'packed': return Boxes;
    case 'shipping': return Truck;
    case 'delivered': return Home;
    default: return Package;
  }
}

/**
 * Statuses that end the journey early. These are terminal states, not
 * forward progress, so the predefined journey (Placed → Delivered) is
 * meaningless for them and a dedicated terminal view is shown instead.
 */
export const TERMINAL_STATUSES: Record<string, string> = {
  cancelled: 'Order Cancelled',
  returned: 'Order Returned',
  damaged: 'Order Damaged',
};

export const COURIER_INFO: Record<string, { name: string; logo?: string }> = {
  steadfast: { name: 'Steadfast Courier', logo: '/couriers/steadfast.png' },
  pathao: { name: 'Pathao Courier', logo: '/couriers/pathao.png' },
  redx: { name: 'RedX Delivery', logo: '/couriers/redx.webp' },
  carrybee: { name: 'Carrybee Express', logo: '/couriers/carrybee.jpg' },
};

export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function isPhoneNumber(input: string): boolean {
  const cleaned = input.replace(/[^\d+]/g, '');
  return (
    (cleaned.startsWith('+8801') && cleaned.length === 14) ||
    (cleaned.startsWith('8801') && cleaned.length === 13) ||
    (cleaned.startsWith('01') && cleaned.length === 11) ||
    (cleaned.startsWith('1') && cleaned.length === 10 && /^1[3-9]/.test(cleaned))
  );
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return '';
  const cleaned = phone.replace(/[^\d+]/g, '');
  const local = cleaned.startsWith('+880') 
    ? cleaned.slice(3) 
    : cleaned.startsWith('880') 
      ? cleaned.slice(2) 
      : cleaned;
  if (local.length === 11 && local.startsWith('01')) {
    return local.slice(0, 3) + '***' + local.slice(7);
  }
  if (cleaned.length > 7) {
    return cleaned.slice(0, 3) + '***' + cleaned.slice(-4);
  }
  return cleaned;
}

export function resolveCustomerInfo(order: OrderData): { name: string; phone: string } {
  // The public tracking DTO carries no customer name and no phone, so both
  // resolve to a neutral placeholder rather than fabricated data.
  const name = [order.customerFirstName, order.customerLastName].filter(Boolean).join(' ')
    || order.guestName
    || order.customer?.name
    || '';

  const rawPhone = order.customerPhone
    || order.guestPhone
    || order.customer?.phone
    || '';

  // No phone is ever fabricated here. The public tracking DTO is
  // deliberately no-PII, so a masked number is shown only when the
  // order actually carries one.
  return {
    name: name.trim() || 'Customer',
    phone: maskPhone(rawPhone),
  };
}

/**
 * Resolves the delivery location shown on the public tracking page.
 *
 * The public endpoints (`/orders/public/display/:displayId`,
 * `/orders/public/phone/:phone`) are reachable by anyone who knows the
 * order number, and their DTO intentionally carries only city/district —
 * the street address and phone inside `shippingAddress` never leave the
 * service. Only what the API actually returns is rendered, so this can
 * never surface an address the endpoint withholds.
 */
export function resolveFullAddress(order: OrderData): string {
  const addr = order.shippingAddress;
  if (!addr || typeof addr !== 'object') return 'Address not available';

  const city = addr.city || addr.district || null;
  return city || 'Address not available';
}

/**
 * Resolves the terminal label for a status that ends the journey early
 * (cancelled / returned / damaged), or null when the order is progressing
 * normally through the predefined journey.
 */
export function resolveTerminalState(statusName: string): string | null {
  const normalized = (statusName || '').trim().toLowerCase();
  return TERMINAL_STATUSES[normalized] ?? null;
}

/**
 * Determines stage index (0 to 4) based on status name and timeline entries.
 * 0: Placed
 * 1: Confirmed
 * 2: Packed
 * 3: Shipping
 * 4: Delivered
 */
export function determineActiveStageIndex(statusName: string, timeline: TimelineEntry[] = []): number {
  const normalizedStatus = (statusName || '').trim().toLowerCase();

  // A terminal order must never report forward progress. Terminal labels
  // are resolved separately by resolveTerminalState().
  if (TERMINAL_STATUSES[normalizedStatus]) return 0;

  if (normalizedStatus.includes('deliver') && !normalizedStatus.includes('out') && !normalizedStatus.includes('failed')) {
    return 4;
  }
  if (normalizedStatus.includes('shipping') || normalizedStatus.includes('in_transit') || normalizedStatus.includes('in transit') || normalizedStatus.includes('transit')) {
    return 3;
  }
  if (normalizedStatus.includes('packed')) {
    return 2;
  }
  if (normalizedStatus.includes('confirmed')) {
    return 1;
  }
  if (normalizedStatus.includes('pending') || normalizedStatus.includes('hold') || normalizedStatus.includes('verifying')) {
    return 0;
  }

  // Fallback: check timeline entries if current status name is custom or non-standard
  for (let i = timeline.length - 1; i >= 0; i--) {
    const s = (timeline[i].status || '').toLowerCase();
    if (s.includes('deliver') && !s.includes('out') && !s.includes('failed')) return 4;
    if (s.includes('shipping') || s.includes('transit')) return 3;
    if (s.includes('packed')) return 2;
    if (s.includes('confirmed')) return 1;
  }

  return 0;
}

export function isStageInTimeline(stageKey: string, timeline: TimelineEntry[] = []): { reached: boolean; entry?: TimelineEntry } {
  for (const entry of timeline) {
    const s = (entry.status || '').toLowerCase();
    const n = (entry.note || '').toLowerCase();
    switch (stageKey) {
      case 'placed':
        if (s.includes('pending') || s.includes('placed') || n.includes('created')) return { reached: true, entry };
        break;
      case 'confirmed':
        if (s.includes('confirmed') || n.includes('confirmed')) return { reached: true, entry };
        break;
      case 'packed':
        if (s.includes('packed') || n.includes('packed')) return { reached: true, entry };
        break;
      case 'shipping':
        if (s.includes('shipping') || s.includes('transit') || n.includes('transit') || n.includes('shipping')) return { reached: true, entry };
        break;
      case 'delivered':
        if ((s.includes('delivered') || n.includes('delivered')) && !s.includes('failed')) return { reached: true, entry };
        break;
    }
  }
  return { reached: false };
}

export default function OrdersPage() {
  const router = useRouter();
  const { config } = useStorefrontConfig();
  const supportPhone = config?.order?.callNumber || config?.store?.phone || '';
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<OrderData | null>(null);
  const [ordersList, setOrdersList] = useState<OrderData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Record<number, boolean>>({});

  const toggleExpand = (idx: number) => {
    setExpandedNotes(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const performSearch = async (num: string) => {
    let trimmed = num.trim();
    if (trimmed.startsWith('#')) {
      trimmed = trimmed.substring(1).trim();
    }
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    setOrdersList(null);
    try {
      if (isPhoneNumber(trimmed)) {
        const { data } = await apiClient.get<OrderData[]>(`/orders/public/phone/${encodeURIComponent(trimmed)}`);
        if (!data || data.length === 0) {
          setError('No orders found for this phone number.');
        } else if (data.length === 1) {
          setOrder(data[0]);
        } else {
          setOrdersList(data);
        }
      } else {
        const { data } = await apiClient.get<OrderData>(`/orders/public/display/${encodeURIComponent(trimmed)}`);
        setOrder(data);
      }
    } catch (err: any) {
      console.error('Search error details:', err?.response?.data || err?.message || err);
      setError(err?.response?.data?.message || 'Order not found. Please check your order number or phone number.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    let trimmed = orderNumber.trim();
    if (trimmed.startsWith('#')) {
      trimmed = trimmed.substring(1).trim();
    }
    if (!trimmed) return;
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/orders?id=${encodeURIComponent(trimmed)}`);
    }
    performSearch(trimmed);
  };

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      let id = params.get('id');
      if (!id) {
        const segments = window.location.pathname.split('/').filter(Boolean);
        if (segments.length >= 2 && segments[0] === 'orders') {
          id = decodeURIComponent(segments[1]);
        }
      }
      if (id) {
        let cleanId = id.trim();
        if (cleanId.startsWith('#')) {
          cleanId = cleanId.substring(1).trim();
        }
        setOrderNumber(cleanId);
        performSearch(cleanId);
      }
    }
  }, []);

  const activeStageIdx = order ? determineActiveStageIndex(order.status?.name || 'Pending', order.timeline) : 0;
  const terminalState = order ? resolveTerminalState(order.status?.name || '') : null;
  const customerInfo = order ? resolveCustomerInfo(order) : { name: '', phone: '' };
  const fullAddress = order ? resolveFullAddress(order) : '';
  const courierKey = (order?.shipment?.courier || '').toLowerCase();
  const courierMeta = courierKey ? COURIER_INFO[courierKey] : null;
  const courierDisplayName = courierMeta?.name || order?.shipment?.courier || 'Courier Assigned';
  const hasCourier = Boolean(order?.shipment?.courier || order?.shipment?.trackingCode);

  return (
    <div className="bg-[#f8f9fa] min-h-screen pb-12 font-sans text-gray-800">
      {/* 1. Track Your Order Header + Compact Search Row */}
      <div className="bg-white border-b border-gray-100 py-4 md:py-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">Track Your Order</h1>
              <p className="text-xs md:text-sm text-gray-500 mt-0.5">
                Real-time delivery status for your package
              </p>
            </div>
            <nav className="flex items-center gap-1.5 text-xs text-gray-400 font-medium self-start md:self-auto">
              <button 
                onClick={() => router.push('/')} 
                className="hover:text-brand-blue transition-colors"
              >
                Home
              </button>
              <ChevronRight size={12} />
              <span className="text-gray-600">Track Order</span>
            </nav>
          </div>

          {/* Compact Input + Track Now row */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
              <input
                type="text"
                placeholder="Order ID (e.g. ORD-261001-0015) or Phone"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full h-10 md:h-11 pl-10 pr-3 rounded-lg border border-gray-200 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition-all text-sm bg-white"
              />
            </div>
            <button
              type="submit"
              className="h-10 md:h-11 bg-brand-blue hover:bg-brand-blue/90 text-white px-5 rounded-lg font-semibold text-sm transition-all shadow-sm active:scale-98 flex items-center gap-1.5 shrink-0"
            >
              <span>Track Now</span>
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 md:pt-6 space-y-4">
        {loading && (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center shadow-sm">
            <div className="inline-block w-7 h-7 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-3 text-gray-500 text-sm font-medium">Looking up your order status...</p>
          </div>
        )}

        {error && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm text-center">
            <Package className="mx-auto text-gray-300 mb-2.5" size={40} />
            <h3 className="text-base font-bold text-gray-800 mb-1">Order Not Found</h3>
            <p className="text-gray-500 text-sm mb-4 max-w-sm mx-auto">{error}</p>
            <button
              onClick={() => { setError(null); setOrderNumber(''); }}
              className="text-brand-blue text-sm font-semibold hover:underline"
            >
              Try another Order ID
            </button>
          </div>
        )}

        {order && !loading && !error && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {ordersList && ordersList.length > 1 && (
              <button
                onClick={() => setOrder(null)}
                className="flex items-center gap-1.5 text-gray-600 hover:text-brand-blue transition-colors font-medium text-xs bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-2xs"
              >
                <ArrowLeft size={14} />
                <span>Back to {ordersList.length} search results</span>
              </button>
            )}

            {/* 2 & 3. Compact Order Overview Card */}
            <div className="bg-white rounded-xl border border-gray-200/80 p-4 md:p-5 shadow-2xs">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
                <div className="min-w-0">
                  <span className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase block mb-0.5">
                    Order Reference
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-base md:text-lg font-bold text-gray-900 tracking-tight">
                      {order.displayId}
                    </span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500 font-medium">
                      {formatDate(order.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="shrink-0 text-right">
                  <span className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase block mb-0.5">
                    Status
                  </span>
                  <span 
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border"
                    style={{
                      borderColor: order.status?.color ? order.status.color + '40' : '#3B82F640',
                      color: order.status?.color || '#3B82F6',
                      backgroundColor: order.status?.color ? order.status.color + '15' : '#3B82F615',
                    }}
                  >
                    {order.status?.name || 'Processing'}
                  </span>
                </div>
              </div>

              {/* Customer + Masked Phone + Full Delivery Address */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 text-xs md:text-sm">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 shrink-0 mt-0.5">
                    <User size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{customerInfo.name}</p>
                    {customerInfo.phone && (
                      <div className="flex items-center gap-1.5 text-gray-500 text-xs mt-0.5">
                        <Phone size={12} className="shrink-0 text-gray-400" />
                        <span className="font-mono">{customerInfo.phone}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 shrink-0 mt-0.5">
                    <MapPin size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-gray-700 leading-snug break-words">
                      {fullAddress}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 & 5. Unified Courier Tracking Card (one card, no duplicates) */}
            {hasCourier && (
              <div className="bg-white rounded-xl border border-gray-200/80 p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden relative p-1">
                    {courierMeta?.logo ? (
                      <Image
                        src={courierMeta.logo}
                        alt={courierDisplayName}
                        width={36}
                        height={36}
                        className="object-contain"
                      />
                    ) : (
                      <Truck size={20} className="text-brand-blue" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900 text-sm truncate">{courierDisplayName}</h3>
                      <span className="text-[11px] px-2 py-0.2 rounded-md bg-blue-50 text-brand-blue font-semibold">
                        Courier Partner
                      </span>
                    </div>
                    {order.shipment?.trackingCode ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Tracking ID: <span className="font-mono font-semibold text-gray-800">{order.shipment.trackingCode}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">Parcel booked for handover</p>
                    )}
                  </div>
                </div>

                {order.trackingUrl && (
                  <a
                    href={order.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-brand-blue/10 hover:bg-brand-blue/20 text-brand-blue px-3.5 py-2 rounded-lg transition-colors shrink-0 self-stretch sm:self-auto"
                  >
                    <span>Track on Courier</span>
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}

            {/* 6, 7, 9. Predefined Full Order Journey (Completed ✓, Active ●, Future ○) */}
            <div className="bg-white rounded-xl border border-gray-200/80 p-4 md:p-5 shadow-2xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-brand-blue flex items-center justify-center shrink-0">
                    <Sparkles size={15} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 leading-tight">
                      Tracking Journey
                    </h3>
                    {!terminalState && (
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {activeStageIdx === JOURNEY_STAGES.length - 1
                          ? 'Package successfully delivered'
                          : `Currently at ${JOURNEY_STAGES[activeStageIdx].label}`}
                      </p>
                    )}
                  </div>
                </div>

                {!terminalState && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50/70 border border-brand-blue/20 text-brand-blue text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-pulse"></span>
                    <span>Step {activeStageIdx + 1} of {JOURNEY_STAGES.length}</span>
                  </div>
                )}
              </div>

              {terminalState ? (
                /* A cancelled / returned / damaged order never progresses
                   toward delivery, so the forward journey is replaced by a
                   plain terminal statement instead of a misleading rail. */
                <div className="flex items-start gap-3 rounded-lg bg-red-50/60 border border-red-100 p-3.5">
                  <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-red-700">{terminalState}</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      This order will not continue through the delivery journey. Please contact support if you need help with this order.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Desktop Scannable Step Bar (visible on md+) */}
                  <div className="hidden md:block mb-6 pt-2 pb-1">
                    <div className="grid grid-cols-5 gap-0 relative">
                      {/* Full-width track line behind connectors */}
                      <div className="absolute top-[17px] left-[10%] right-[10%] h-[3px] bg-gray-100 rounded-full z-0">
                        {/* Progress Fill */}
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${(Math.min(activeStageIdx, JOURNEY_STAGES.length - 1) / (JOURNEY_STAGES.length - 1)) * 100}%`
                          }}
                        />
                      </div>

                      {JOURNEY_STAGES.map((stage, idx) => {
                        const isCompleted = idx < activeStageIdx;
                        const isActive = idx === activeStageIdx;
                        const Icon = getStageIcon(stage.key);

                        return (
                          <div key={`desktop-${stage.key}`} className="flex flex-col items-center text-center relative z-10 px-1">
                            {/* Round Icon Disc */}
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-emerald-500 text-white shadow-xs'
                                  : isActive
                                    ? 'bg-brand-blue text-white ring-4 ring-brand-blue/20 shadow-md scale-105'
                                    : 'bg-white border-2 border-gray-200 text-gray-400'
                              }`}
                            >
                              {isCompleted ? (
                                <Check size={16} strokeWidth={3} />
                              ) : (
                                <Icon size={16} strokeWidth={isActive ? 2.3 : 1.8} />
                              )}
                            </div>

                            <span
                              className={`text-xs font-semibold mt-2 truncate w-full px-1 ${
                                isActive
                                  ? 'text-brand-blue font-bold'
                                  : isCompleted
                                    ? 'text-gray-900'
                                    : 'text-gray-400'
                              }`}
                            >
                              {stage.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Vertical Journey List with Stage Cards (mobile-first, polished) */}
                  <div className="relative pl-7 md:pl-8 space-y-3">
                    {/* Vertical connecting rail line */}
                    <div className="absolute left-[13px] md:left-[15px] top-3 bottom-3 w-[2px] bg-gray-100 rounded-full z-0">
                      {/* Active progress track indicator on rail */}
                      <div
                        className="w-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{
                          height: `${(Math.min(activeStageIdx, JOURNEY_STAGES.length - 1) / (JOURNEY_STAGES.length - 1)) * 100}%`
                        }}
                      />
                    </div>

                    {JOURNEY_STAGES.map((stage, idx) => {
                      const isCompleted = idx < activeStageIdx;
                      const isActive = idx === activeStageIdx;
                      const isFuture = idx > activeStageIdx;
                      const timelineCheck = isStageInTimeline(stage.key, order.timeline);
                      const Icon = getStageIcon(stage.key);

                      return (
                        <div key={stage.key} className="relative flex items-start gap-3 text-left">
                          {/* Node Icon Circle */}
                          <div
                            className={`absolute -left-7 md:-left-8 top-1.5 w-[26px] h-[26px] md:w-[30px] md:h-[30px] rounded-full flex items-center justify-center transition-all z-10 ${
                              isCompleted
                                ? 'bg-emerald-500 text-white shadow-xs'
                                : isActive
                                  ? 'bg-brand-blue text-white ring-4 ring-brand-blue/20 shadow-sm'
                                  : 'bg-white border-2 border-gray-200 text-gray-300'
                            }`}
                          >
                            {isCompleted ? (
                              <Check size={14} strokeWidth={3} />
                            ) : (
                              <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                            )}
                          </div>

                          {/* Stage Content Card */}
                          <div
                            className={`flex-1 min-w-0 rounded-lg p-2.5 md:p-3 transition-all ${
                              isActive
                                ? 'bg-blue-50/50 border border-brand-blue/20 shadow-2xs'
                                : isCompleted
                                  ? 'bg-gray-50/50 border border-gray-100'
                                  : 'bg-transparent border border-transparent'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-xs md:text-sm font-bold ${
                                    isActive
                                      ? 'text-brand-blue'
                                      : isCompleted
                                        ? 'text-gray-900'
                                        : 'text-gray-400'
                                  }`}
                                >
                                  {stage.label}
                                </span>
                                {isActive && (
                                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-sm bg-brand-blue text-white">
                                    Current
                                  </span>
                                )}
                              </div>

                              {timelineCheck.entry?.timestamp ? (
                                <span className="text-[11px] text-gray-500 font-medium">
                                  {formatDate(timelineCheck.entry.timestamp)} · {formatTime(timelineCheck.entry.timestamp)}
                                </span>
                              ) : isFuture ? (
                                <span className="text-[11px] text-gray-300 italic font-normal">
                                  Upcoming
                                </span>
                              ) : null}
                            </div>

                            <p
                              className={`text-xs mt-0.5 leading-relaxed ${
                                isActive
                                  ? 'text-gray-700 font-medium'
                                  : isCompleted
                                    ? 'text-gray-500'
                                    : 'text-gray-400'
                              }`}
                            >
                              {stage.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 8 & 10. Secondary Detailed Timeline Updates (Clean & Compact) */}
            {order.timeline && order.timeline.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200/80 p-4 md:p-5 shadow-2xs">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  Activity Log & Courier Updates
                </h3>
                <div className="space-y-3">
                  {order.timeline.map((entry, idx) => {
                    const rawNote = entry.note || '';
                    const isLongNote = rawNote.length > 90;
                    const isExpanded = expandedNotes[idx];

                    return (
                      <div key={`${entry.status}-${entry.timestamp}-${idx}`} className="flex items-start gap-2.5 text-xs pb-2.5 border-b border-gray-50 last:border-0 last:pb-0">
                        <div className="w-6 h-6 rounded-full bg-blue-50 text-brand-blue flex items-center justify-center shrink-0 mt-0.5">
                          <Clock size={12} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-1">
                            <span className="font-semibold text-gray-800 text-xs">
                              {entry.status}
                            </span>
                            <span className="text-[11px] text-gray-400 font-mono">
                              {formatTime(entry.timestamp)} · {formatDate(entry.timestamp)}
                            </span>
                          </div>
                          {rawNote && (
                            <div className="mt-1 text-gray-500 leading-snug">
                              <p className={!isExpanded && isLongNote ? 'line-clamp-2' : ''}>
                                {rawNote}
                              </p>
                              {isLongNote && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(idx)}
                                  className="text-[11px] font-semibold text-brand-blue hover:underline mt-0.5 flex items-center gap-0.5"
                                >
                                  <span>{isExpanded ? 'Show less' : 'View details'}</span>
                                  <ChevronDown size={11} className={isExpanded ? 'rotate-180' : ''} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 11 & 12. Delivering To & Support Helper (Compact Two-Column Section) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Delivering To Card */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-4 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 mb-2">
                    <MapPin size={14} className="text-brand-blue shrink-0" />
                    <span>Delivering To</span>
                  </div>
                  <p className="text-xs md:text-sm text-gray-700 leading-relaxed font-medium break-words">
                    {fullAddress}
                  </p>
                </div>
                <p className="text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-100">
                  Recipient: <span className="font-medium text-gray-600">{customerInfo.name}</span>
                  {customerInfo.phone && ` (${customerInfo.phone})`}
                </p>
              </div>

              {/* Support Helper Card */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-4 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 mb-1.5">
                    <Headphones size={14} className="text-brand-blue shrink-0" />
                    <span>Support Helper</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">
                    Need any help or modification for your parcel? Our customer care is ready to assist.
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400 font-medium">Customer Support</span>
                  {supportPhone ? (
                    <a
                      href={`tel:${supportPhone.replace(/[^0-9]/g, '')}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
                    >
                      <Phone size={12} />
                      <span>{supportPhone}</span>
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">Available 24/7</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Multi-order Search Results (by phone) */}
        {ordersList && !order && !loading && !error && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white rounded-xl border border-gray-200/80 p-3.5 shadow-2xs flex items-center justify-between gap-3">
              <div>
                <h3 className="text-gray-900 text-sm font-bold">Orders Found ({ordersList.length})</h3>
                <p className="text-gray-500 text-xs">Select an order to track delivery status</p>
              </div>
              <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 px-2.5 py-1 rounded-md">
                {orderNumber}
              </span>
            </div>

            <div className="space-y-2">
              {ordersList.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => setOrder(item)}
                  className="bg-white rounded-xl border border-gray-200/80 p-3.5 shadow-2xs hover:border-brand-blue transition-all cursor-pointer group flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-sm group-hover:text-brand-blue transition-colors">
                        {item.displayId}
                      </span>
                      <span 
                        className="text-[11px] px-2 py-0.2 rounded-full font-semibold border"
                        style={{ 
                          borderColor: item.status?.color ? item.status.color + '40' : '#e2e8f0', 
                          color: item.status?.color || '#4a5568',
                          backgroundColor: item.status?.color ? item.status.color + '15' : '#f7fafc'
                        }}
                      >
                        {item.status?.name || 'Processing'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-2">
                      <span>{formatDate(item.createdAt)}</span>
                      <span>·</span>
                      <span>{item.items.reduce((acc, it) => acc + it.quantity, 0)} items</span>
                      <span>·</span>
                      <span className="font-semibold text-gray-800">{formatPrice(item.total)}</span>
                    </p>
                  </div>

                  <span className="text-brand-blue font-semibold text-xs flex items-center gap-1 group-hover:translate-x-1 transition-transform shrink-0">
                    Track <ChevronRight size={14} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
