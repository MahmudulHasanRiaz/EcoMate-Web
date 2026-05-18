"use client";

import React, { useState, useMemo } from 'react';
import { ChevronRight, Filter, ChevronDown, LayoutGrid, List, Search, X } from 'lucide-react';
import { PRODUCTS } from '@/lib/constants';
import ProductCard from '@/components/ProductCard';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ArchivePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const initialCategory = searchParams.get('category') || '';

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(initialCategory || null);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [priceRange, setPriceRange] = useState([0, 5000]);
  const [sortBy, setSortBy] = useState('default');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const categories = [
    { id: 'honey', name: 'Honey' },
    { id: 'oil', name: 'Oil & Ghee' },
    { id: 'dates', name: 'Dates' },
    { id: 'spices', name: 'Spices' },
    { id: 'nuts', name: 'Nuts & Seeds' },
    { id: 'beverage', name: 'Beverage' },
    { id: 'rice', name: 'Rice' },
    { id: 'flour', name: 'Flours & Lentils' },
    { id: 'organic', name: 'Organic' },
  ];

  const brands = ['Bragg', 'DISCOVERY', 'Karkuma', 'Organic', 'Sundarban'];

  const filteredProducts = useMemo(() => {
    let result = [...PRODUCTS];

    if (searchQuery) {
      result = result.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    if (selectedCategoryId) {
      result = result.filter(p => p.name.toLowerCase().includes(selectedCategoryId.toLowerCase()));
    }

    if (selectedBrands.length > 0) {
      result = result.filter(p => selectedBrands.some(brand => p.name.includes(brand)));
    }

    result = result.filter(p => p.price >= priceRange[0] && p.price <= priceRange[1]);

    if (sortBy === 'price-low') result.sort((a, b) => a.price - b.price);
    if (sortBy === 'price-high') result.sort((a, b) => b.price - a.price);

    return result;
  }, [selectedCategoryId, selectedBrands, priceRange, sortBy, searchQuery]);

  const toggleBrand = (brand: string) => {
    setSelectedBrands(prev => 
      prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand]
    );
  };

  const currentCategoryName = categories.find(c => c.id === selectedCategoryId)?.name || 'Products';

  return (
    <div className="bg-white min-h-screen pb-20 font-sans">
      {/* Breadcrumbs & Title */}
      <div className="bg-[#f5f5f5] py-3 md:py-4 border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between">
          <h1 className="text-[17px] md:text-[18px] font-medium text-gray-800">
            {currentCategoryName}
          </h1>
          <nav className="flex items-center gap-1 text-[13px] text-gray-500 font-normal">
            <button 
              onClick={() => router.push('/')} 
              className="hover:text-brand-blue cursor-pointer transition-colors"
            >
              Home
            </button>
            <ChevronRight size={12} className="opacity-70 mx-1" strokeWidth={2} />
            <span className="text-gray-800">{currentCategoryName}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-4 md:py-6">
        
        {/* Compact Toolbar */}
        <div className="bg-white rounded-[4px] border border-gray-200 p-1.5 md:p-2 mb-4 md:mb-6 flex items-center justify-between gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <button 
             onClick={() => setIsFilterOpen(true)} 
             className="flex items-center gap-2 border border-brand-blue text-brand-blue px-4 py-1.5 md:py-2 rounded-[4px] font-medium text-[12px] md:text-[13px] uppercase hover:bg-brand-blue/5 transition-colors whitespace-nowrap"
          >
             <Filter size={15} strokeWidth={2}/> FILTERS
          </button>
          
          <div className="flex-1 hidden md:block"></div>

          <div className="flex items-center gap-2">
            <div className="relative flex-shrink-0">
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none bg-white border border-gray-200 rounded-[4px] px-3 py-1.5 md:px-4 md:py-2 pr-8 text-[12px] md:text-[13px] text-gray-600 outline-none focus:border-brand-blue transition-all cursor-pointer"
              >
                <option value="default">Default Sorting</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="newest">Newest Arrival</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            </div>

            <div className="relative flex-shrink-0">
               <select className="appearance-none bg-white border border-gray-200 rounded-[4px] px-3 py-1.5 md:px-4 md:py-2 pr-8 text-[12px] md:text-[13px] text-gray-600 outline-none focus:border-brand-blue transition-all cursor-pointer">
                  <option value="default">Default</option>
                  <option value="12">12 Items</option>
                  <option value="24">24 Items</option>
               </select>
               <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            </div>
            
            <div className="hidden md:flex flex-shrink-0 items-center gap-1 bg-white border border-gray-200 p-0.5 rounded ml-1">
               <button 
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-[#f5f5f5] text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
               >
                  <LayoutGrid size={16} />
               </button>
               <button 
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-[#f5f5f5] text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
               >
                  <List size={16} />
               </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 md:gap-8">
          
          {/* Left Sidebar: Desktop Filters */}
          <aside className={`fixed inset-0 z-[100] md:relative md:inset-auto md:z-0 md:w-64 lg:w-[280px] space-y-6 transition-transform duration-300 ${isFilterOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <div className="h-full bg-[#f8f9fa] md:bg-transparent overflow-y-auto md:overflow-visible p-6 md:p-0 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-gray-800 uppercase tracking-widest">Filters</h3>
                <div className="flex items-center gap-4">
                  <button onClick={() => { setSelectedBrands([]); setPriceRange([0, 5000]); setSelectedCategoryId(null); }} className="text-[12px] font-bold text-gray-400 hover:text-brand-blue uppercase tracking-wider transition-colors">Clear All</button>
                  <button onClick={() => setIsFilterOpen(false)} className="md:hidden text-gray-400 hover:text-gray-800"><X size={20} /></button>
                </div>
              </div>

              <div className="bg-white border border-gray-100 md:rounded-[12px] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.02)]">
                
                {/* Category Filter */}
                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Categories
                    <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {categories.map((cat) => (
                      <label key={cat.id} className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <input 
                            type="radio" 
                            name="category"
                            checked={selectedCategoryId === cat.id}
                            onChange={() => setSelectedCategoryId(cat.id)}
                            className="w-3.5 h-3.5 text-brand-blue border-gray-300 focus:ring-brand-blue"
                          />
                          <span className={`text-[13px] transition-colors ${selectedCategoryId === cat.id ? 'font-bold text-brand-blue' : 'font-medium text-gray-600 group-hover:text-gray-900'}`}>
                            {cat.name}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Price Range Filter */}
                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Price Range
                    <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="space-y-5">
                    <input 
                      type="range" 
                      min="0" 
                      max="5000" 
                      value={priceRange[1]}
                      onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value)])}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-blue"
                    />
                    <div className="flex items-center gap-3">
                       <div className="flex-1 border border-gray-200 rounded-md py-2 px-3 flex items-center gap-1 bg-gray-50 focus-within:border-brand-blue focus-within:bg-white transition-colors">
                          <span className="text-gray-400 text-[13px] font-medium font-mono">৳</span>
                          <input type="number" value={priceRange[0]} onChange={(e) => setPriceRange([parseInt(e.target.value) || 0, priceRange[1]])} className="w-full text-[13px] font-bold text-gray-800 outline-none bg-transparent" min="0" />
                       </div>
                       <span className="text-gray-300 font-bold">-</span>
                       <div className="flex-1 border border-gray-200 rounded-md py-2 px-3 flex items-center gap-1 bg-gray-50 focus-within:border-brand-blue focus-within:bg-white transition-colors">
                          <span className="text-gray-400 text-[13px] font-medium font-mono">৳</span>
                          <input type="number" value={priceRange[1]} onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value) || 0])} className="w-full text-[13px] font-bold text-gray-800 outline-none bg-transparent" min="0" />
                       </div>
                    </div>
                  </div>
                </div>

                {/* Brand Filter */}
                <div className="p-5">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Brands
                    <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="relative mb-4">
                     <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                     <input type="text" placeholder="Search brands..." className="w-full bg-[#f8f9fa] border border-gray-100 rounded-md py-2 pl-8 pr-3 text-[12px] outline-none focus:border-brand-blue transition-colors" />
                  </div>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {brands.map((brand) => (
                      <label key={brand} className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <div className="relative flex items-center justify-center">
                            <input 
                              type="checkbox" 
                              checked={selectedBrands.includes(brand)}
                              onChange={() => toggleBrand(brand)}
                              className="peer sr-only"
                            />
                            <div className="w-[18px] h-[18px] border border-gray-300 rounded-[4px] bg-white peer-checked:bg-brand-blue peer-checked:border-brand-blue transition-all"></div>
                            <svg className="absolute w-[10px] h-[10px] text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 14 14" fill="none">
                               <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <span className={`text-[13px] transition-colors ${selectedBrands.includes(brand) ? 'font-bold text-gray-900' : 'font-medium text-gray-600 group-hover:text-gray-900'}`}>
                            {brand}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Content: Products Grid */}
          <main className="flex-1">
            <div className={`grid gap-3 md:gap-4 ${viewMode === 'grid' ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
              {filteredProducts.length > 0 ? (
                filteredProducts.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))
              ) : (
                <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                    <Search size={40} />
                  </div>
                  <h3 className="text-xl font-bold text-gray-800 mb-2">No Products Found</h3>
                  <p className="text-gray-500">Try adjusting your filters or search criteria.</p>
                  <button 
                    onClick={() => { 
                      setSelectedBrands([]); 
                      setPriceRange([0, 5000]); 
                      setSelectedCategoryId(null); 
                    }}
                    className="mt-6 text-brand-blue font-bold uppercase text-[13px] hover:underline"
                  >
                    Clear All Filters
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
      
      {/* Overlay for mobile filter */}
      {isFilterOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-[90] md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsFilterOpen(false)}
        />
      )}
    </div>
  );
}
