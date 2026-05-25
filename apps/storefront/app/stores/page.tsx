import type { Metadata } from "next";
import { MapPin, Phone, Clock, Navigation } from 'lucide-react';
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("Our Stores", "Visit the {store} flagship store in Dhaka. Find our location, hours, and contact information.");
}

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

const STORE_IMAGE = "https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&q=80&w=1200";

export default async function StoresPage() {
  let config;
  try { config = await getStorefrontConfigServer(); } catch {}
  const s = config?.store;
  const soc = config?.social;
  const phoneDigits = s?.phone ? s.phone.replace(/[^0-9]/g, '') : "8801700000000";
  const address = s?.address || "Level 6, Block D, Shop 63-64, Bashundhara City Shopping Mall, Dhaka";
  const storeName = s?.name || "Store";

  return (
    <div className="bg-[#fcfcfc] min-h-screen">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 pt-16 md:pt-24 pb-12">
        <h1 className="text-5xl md:text-8xl font-black text-gray-900 tracking-tighter uppercase leading-[0.8] mb-8">
          FIND OUR <br /><span className="text-brand-blue">STORES.</span>
        </h1>
        <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between border-t border-gray-200 pt-10">
           <p className="text-gray-500 max-w-md text-sm md:text-base leading-relaxed">
             Experience the innovation of {storeName} in person. Visit our physical store to explore our signature products.
           </p>
           <a href="https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8" target="_blank" rel="noreferrer"
              className="flex items-center gap-2 bg-brand-blue text-white px-6 py-3 rounded-full font-bold text-[14px] hover:bg-brand-blue/90 transition-all shadow-md">
             <Navigation size={16} />
             GET DIRECTIONS
           </a>
        </div>
      </div>

      {/* Stores Grid */}
      <div className="max-w-7xl mx-auto px-4 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {/* Main Store */}
          <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
               <div className="relative aspect-[4/3] overflow-hidden">
                  <img 
                    src={STORE_IMAGE}
                    alt={storeName + " Warehouse"} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <a 
                    href="https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8" 
                    target="_blank" 
                    rel="noreferrer"
                    className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-sm rounded-xl p-4 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0"
                  >
                    <div className="w-10 h-10 rounded-full bg-brand-blue/10 flex items-center justify-center flex-shrink-0">
                      <Navigation size={18} className="text-brand-blue" />
                    </div>
                    <div className="text-left">
                      <p className="text-[13px] font-bold text-gray-800">Get Directions</p>
                       <p className="text-[11px] text-gray-500">{storeName + " Warehouse"}</p>
                    </div>
                  </a>
               </div>
               <div className="p-6 space-y-5">
                 <h3 className="text-xl font-bold text-gray-800">{storeName} Warehouse &bull; Dhaka</h3>
                 <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin size={16} className="text-brand-blue shrink-0 mt-0.5" />
                      <span className="text-[14px] text-gray-600">{address}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Phone size={16} className="text-brand-blue shrink-0" />
                      <span className="text-[14px] text-gray-600">{s?.phone || "+880 1700-000000"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Clock size={16} className="text-brand-blue shrink-0" />
                      <span className="text-[14px] text-gray-600">Sat - Thu: 9 AM - 9 PM</span>
                    </div>
                 </div>

                 <div className="flex gap-3 pt-2">
                     <a href={`tel:${phoneDigits}`} className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-800 text-[13px] font-bold py-3 rounded-full transition-colors">Call Now</a>
                    <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="flex-1 text-center bg-brand-blue hover:bg-brand-blue/90 text-white text-[13px] font-bold py-3 rounded-full transition-colors">WhatsApp</a>
                 </div>
               </div>
          </div>

          {/* Second Store */}
          <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
               <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 flex items-center justify-center">
                 <div className="text-center p-8">
                   <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-brand-blue/10 flex items-center justify-center">
                      <MapPin size={36} className="text-brand-blue" />
                   </div>
                   <p className="text-gray-400 font-bold text-sm uppercase tracking-wider">Coming Soon</p>
                 </div>
               </div>
               <div className="p-6 space-y-5">
                 <h3 className="text-xl font-bold text-gray-800">Chittagong Store</h3>
                 <p className="text-gray-500 text-[14px]">We are expanding! Our second location is coming soon to Chittagong. Stay tuned for updates.</p>
                 <div className="pt-2">
                    <span className="inline-block bg-brand-blue/10 text-brand-blue text-[12px] font-bold px-4 py-2 rounded-full">Opening 2025</span>
                 </div>
               </div>
          </div>

          {/* Third Store */}
          <div className="group bg-white rounded-[40px] overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-500">
               <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 flex items-center justify-center">
                 <div className="text-center p-8">
                   <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-brand-blue/10 flex items-center justify-center">
                      <MapPin size={36} className="text-brand-blue" />
                   </div>
                   <p className="text-gray-400 font-bold text-sm uppercase tracking-wider">Coming Soon</p>
                 </div>
               </div>
               <div className="p-6 space-y-5">
                 <h3 className="text-xl font-bold text-gray-800">Sylhet Store</h3>
                 <p className="text-gray-500 text-[14px]">We are expanding! Our third location is coming soon to Sylhet. Stay tuned for updates.</p>
                 <div className="pt-2">
                    <span className="inline-block bg-brand-blue/10 text-brand-blue text-[12px] font-bold px-4 py-2 rounded-full">Opening 2025</span>
                 </div>
               </div>
          </div>
        </div>
      </div>
    </div>
  );
}
