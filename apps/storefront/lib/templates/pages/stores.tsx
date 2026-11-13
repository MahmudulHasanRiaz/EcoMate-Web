import { MapPin, Phone, Clock, Navigation, Mail, MessageCircle, Globe } from 'lucide-react';
import Image from 'next/image';
import type { StoreLocation, StoreSocial } from "@/lib/api/store-locations";

const TYPE_LABELS: Record<StoreLocation['type'], string> = {
  SHOWROOM: 'Showroom',
  BRANCH: 'Branch',
  OFFICE: 'Office',
};

const TYPE_ORDER: StoreLocation['type'][] = ['SHOWROOM', 'BRANCH', 'OFFICE'];

function formatOpeningDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function SocialIcon({ platform }: { platform: string }) {
  // This lucide-react version ships no brand icons (no Facebook/Instagram/
  // Youtube exports) — use a generic chat icon for messaging platforms and
  // a globe for everything else.
  const key = platform.trim().toLowerCase();
  if (key === 'whatsapp' || key === 'messenger') return <MessageCircle size={16} className="text-brand-blue shrink-0" />;
  return <Globe size={16} className="text-brand-blue shrink-0" />;
}

function socialsOf(store: StoreLocation): StoreSocial[] {
  if (!Array.isArray(store.socials)) return [];
  return store.socials.filter((s) => s?.url?.trim() && s?.platform?.trim());
}

/**
 * Stores template — renders ONLY real locations from GET /store-locations.
 *
 * `config` is accepted solely so this component still satisfies the
 * registry's `ComponentType<{ config }>` until Part A removes the stores
 * registry entry; it is deliberately never read. The legacy CMS stores
 * array (invented entries, shared placeholder photo, hardcoded fallback
 * directions link, hardcoded opening-year badge) is deprecated at
 * cutover and is NOT migrated.
 */
export default function StoresTemplate({
  locations,
}: {
  locations?: StoreLocation[];
  config?: Record<string, any>;
}) {
  const stores: StoreLocation[] = Array.isArray(locations) ? locations : [];
  const openStores = stores.filter((s) => !s.comingSoon);
  const heroMapLink = openStores.find((s) => s.mapUrl)?.mapUrl;
  const groups = TYPE_ORDER.map((type) => ({
    type,
    stores: stores.filter((s) => s.type === type),
  })).filter((g) => g.stores.length > 0);

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 pt-16 md:pt-24 pb-12">
        <h1 className="text-5xl md:text-8xl font-black text-gray-900 tracking-tighter uppercase leading-[0.8] mb-8">
          FIND OUR <br /><span className="text-brand-blue">STORES.</span>
        </h1>
        <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between border-t border-gray-200 pt-10">
          <p className="text-gray-500 max-w-md text-sm md:text-base leading-relaxed">
            Visit us in person — find your nearest showroom, branch or office.
          </p>
          {heroMapLink && (
            <a href={heroMapLink} target="_blank" rel="noreferrer"
               className="flex items-center gap-2 bg-brand-blue text-white px-6 py-3 rounded-full font-bold text-[14px] hover:bg-brand-blue/90 transition-all shadow-md">
              <Navigation size={16} />
              GET DIRECTIONS
            </a>
          )}
        </div>
      </div>

      {/* Stores Grid */}
      {stores.length === 0 ? (
        <div className="max-w-7xl mx-auto px-4 py-20 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-brand-blue/10 flex items-center justify-center">
            <MapPin size={36} className="text-brand-blue" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No store locations yet</h2>
          <p className="text-gray-500 text-[14px] max-w-md mx-auto">
            We have not listed any physical locations yet. Please check back soon or contact us online.
          </p>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 py-20 space-y-16">
          {groups.map((group) => (
            <section key={group.type}>
              {groups.length > 1 && (
                <h2 className="text-2xl font-bold text-gray-800 mb-8">
                  {TYPE_LABELS[group.type]}s
                </h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                {group.stores.map((store) =>
                  store.comingSoon ? (
                    <ComingSoonCard key={store.id} store={store} />
                  ) : (
                    <StoreCard key={store.id} store={store} />
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoBlock({ store, label }: { store: StoreLocation; label: string }) {
  if (store.photo) {
    return (
      <Image
        src={store.photo}
        alt={store.name}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover transition-transform duration-700 group-hover:scale-110"
      />
    );
  }
  // Honest empty state — never a shared placeholder image.
  return (
    <div className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center gap-2">
      <MapPin size={32} className="text-gray-300" />
      <p className="text-gray-400 font-bold text-[12px] uppercase tracking-wider">{label}</p>
    </div>
  );
}

function StoreCard({ store }: { store: StoreLocation }) {
  const phoneDigits = store.phone ? store.phone.replace(/[^0-9]/g, '') : "";
  const socials = socialsOf(store);
  const place = [store.city, store.district].filter(Boolean).join(', ');

  return (
    <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
      <div className="relative aspect-[4/3] overflow-hidden">
        <PhotoBlock store={store} label={TYPE_LABELS[store.type] ?? store.type} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute top-4 left-4">
          <span className="inline-block bg-white/90 backdrop-blur-sm text-gray-800 text-[12px] font-bold px-3 py-1.5 rounded-full">
            {TYPE_LABELS[store.type] ?? store.type}
          </span>
        </div>
        {store.mapUrl && (
          <a
            href={store.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-sm rounded-xl p-4 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0"
          >
            <div className="w-10 h-10 rounded-full bg-brand-blue/10 flex items-center justify-center flex-shrink-0">
              <Navigation size={18} className="text-brand-blue" />
            </div>
            <div className="text-left">
              <p className="text-[13px] font-bold text-gray-800">Get Directions</p>
              <p className="text-[11px] text-gray-500">{store.name}</p>
            </div>
          </a>
        )}
      </div>
      <div className="p-6 space-y-5">
        <h3 className="text-xl font-bold text-gray-800">{store.name}</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <MapPin size={16} className="text-brand-blue shrink-0 mt-0.5" />
            <span className="text-[14px] text-gray-600">
              {store.address}
              {place && <span className="block text-gray-500">{place}</span>}
            </span>
          </div>
          {store.phone && (
            <div className="flex items-center gap-3">
              <Phone size={16} className="text-brand-blue shrink-0" />
              <span className="text-[14px] text-gray-600">{store.phone}</span>
            </div>
          )}
          {store.email && (
            <div className="flex items-center gap-3">
              <Mail size={16} className="text-brand-blue shrink-0" />
              <a href={`mailto:${store.email}`} className="text-[14px] text-gray-600 hover:text-brand-blue break-all">
                {store.email}
              </a>
            </div>
          )}
          {store.hours && (
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-brand-blue shrink-0" />
              <span className="text-[14px] text-gray-600">{store.hours}</span>
            </div>
          )}
        </div>

        {socials.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {socials.map((s) => (
              <a
                key={`${s.platform}-${s.url}`}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[12px] font-bold px-3 py-1.5 rounded-full transition-colors"
              >
                <SocialIcon platform={s.platform} />
                {s.platform}
              </a>
            ))}
          </div>
        )}

        {phoneDigits && (
          <div className="flex gap-3 pt-2">
            <a href={`tel:${phoneDigits}`} className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-800 text-[13px] font-bold py-3 rounded-full transition-colors">Call Now</a>
            <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="flex-1 text-center bg-brand-blue hover:bg-brand-blue/90 text-white text-[13px] font-bold py-3 rounded-full transition-colors">WhatsApp</a>
          </div>
        )}
      </div>
    </div>
  );
}

function ComingSoonCard({ store }: { store: StoreLocation }) {
  const opening = formatOpeningDate(store.openingDate);
  const place = [store.city, store.district].filter(Boolean).join(', ');

  return (
    <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
      <div className="relative aspect-[4/3] overflow-hidden">
        <PhotoBlock store={store} label="Coming Soon" />
        <div className="absolute top-4 left-4">
          <span className="inline-block bg-white/90 backdrop-blur-sm text-gray-800 text-[12px] font-bold px-3 py-1.5 rounded-full">
            {TYPE_LABELS[store.type] ?? store.type}
          </span>
        </div>
      </div>
      <div className="p-6 space-y-5">
        <h3 className="text-xl font-bold text-gray-800">{store.name}</h3>
        <p className="text-gray-500 text-[14px]">
          {store.address}
          {place && <span className="block">{place}</span>}
        </p>
        <div className="pt-2">
          <span className="inline-block bg-brand-blue/10 text-brand-blue text-[12px] font-bold px-4 py-2 rounded-full">
            {opening ? `Opening ${opening}` : 'Coming soon'}
          </span>
        </div>
      </div>
    </div>
  );
}
