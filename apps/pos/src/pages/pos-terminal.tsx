import { useState, useRef, useEffect } from 'react'
import { CategorySidebar } from '../components/category-sidebar'
import { ProductGrid } from '../components/product-grid'
import { SearchBar } from '../components/search-bar'
import { CartPanel } from '../components/cart-panel'
import { CashierDashboard } from '../components/cashier-dashboard'
import { useSessionStore } from '../stores/session-store'
import { useCartStore } from '../stores/cart-store'
import { getPosProducts } from '../api/client'
import { VariantModal } from '../components/variant-modal'
import { toast } from 'sonner'
import { LogOut, ShoppingCart, User, Wifi, Menu, X, BarChart3, ChevronRight, Store } from 'lucide-react'

interface Props { onCloseSession: () => void }

export function PosTerminalPage({ onCloseSession }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)
  const [isDashboardOpen, setIsDashboardOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  
  // States for parent-level exact-match variant modal triggering
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [variantModalOpen, setVariantModalOpen] = useState(false)
  
  const { showroomName, cashierName } = useSessionStore()
  const { items } = useCartStore()

  // Close profile popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false)
      }
    }
    if (isProfileOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isProfileOpen])

  const handleSearchSubmit = async () => {
    const query = searchQuery.trim()
    if (!query) return

    try {
      // Query POS products with the query string as a barcode/SKU parameter
      const res = await getPosProducts({ barcode: query })
      const products = res.data?.data || []
      
      if (products.length > 0) {
        const product = products[0]
        
        // 1. Check if the product has type "variable"
        if (product.type === 'variable' && product.variants && product.variants.length > 0) {
          // Verify if one of the variants has this exact SKU
          const matchingVariant = product.variants.find((v: any) => v.sku === query)
          if (matchingVariant) {
            const variantName = matchingVariant.attributeValues
              ?.map((av: any) => av.attributeValue?.value)
              .join(' / ') || matchingVariant.sku
            
            const price = Number(matchingVariant.salePrice || matchingVariant.price || 0)
            if (price) {
              const parentImages = Array.isArray(product.images) ? product.images : []
              const parentImgUrl = parentImages[0]?.url || parentImages[0] || null
              const imgUrl = matchingVariant.image || parentImgUrl || null
              
              useCartStore.getState().addItem({
                productId: product.id,
                variantId: matchingVariant.id,
                name: `${product.name} (${variantName})`,
                sku: matchingVariant.sku,
                price,
                quantity: 1,
                image: imgUrl || undefined,
              })
              setSearchQuery('')
              toast.success(`Added ${product.name} (${variantName})`)
              return
            }
          }
          
          // Ambiguous variant search (matches parent SKU or name but no direct variant SKU)
          setSelectedProduct(product)
          setVariantModalOpen(true)
          setSearchQuery('')
          return
        }

        // 2. Simple product add directly
        const price = Number(product.salePrice || product.basePrice || 0)
        if (price) {
          const images = Array.isArray(product.images) ? product.images : []
          const imgUrl = images[0]?.url || images[0] || null
          
          useCartStore.getState().addItem({
            productId: product.id,
            name: product.name,
            sku: product.sku || undefined,
            price,
            quantity: 1,
            image: imgUrl || undefined,
          })
          setSearchQuery('')
          toast.success(`Added ${product.name}`)
        }
      } else {
        toast.error(`No product found for Barcode/SKU: ${query}`)
      }
    } catch (err) {
      toast.error('Search barcode lookup failed')
    }
  }

  const handleAddVariant = (variant: any, variantName: string) => {
    const price = Number(variant.salePrice || variant.price || 0)
    if (!price || !selectedProduct) return
    const parentImages = Array.isArray(selectedProduct.images) ? selectedProduct.images : []
    const parentImgUrl = parentImages[0]?.url || parentImages[0] || null
    const imgUrl = variant.image || parentImgUrl || null
    
    useCartStore.getState().addItem({
      productId: selectedProduct.id,
      variantId: variant.id,
      name: `${selectedProduct.name} (${variantName})`,
      sku: variant.sku || selectedProduct.sku || undefined,
      price,
      quantity: 1,
      image: imgUrl || undefined,
    })
    toast.success(`Added ${selectedProduct.name} (${variantName})`)
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800 antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 py-2.5 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              if (window.innerWidth < 768) {
                setIsSidebarOpen(!isSidebarOpen)
              } else {
                setIsSidebarCollapsed(!isSidebarCollapsed)
              }
            }}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer"
            title="Toggle Categories"
          >
            {isSidebarOpen || !isSidebarCollapsed ? <X size={20} /> : <Menu size={20} />}
          </button>
          
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white font-black text-base shadow-sm">E</span>
            <span className="text-base font-extrabold tracking-tight text-slate-900">EcoMate <span className="text-emerald-600">POS</span></span>
          </div>
          
          <div className="hidden h-4 w-px bg-slate-200 md:block" />
          
          <span className="hidden items-center gap-1.5 text-xs font-semibold text-slate-500 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{showroomName}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status */}
          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 transition">
            <Wifi size={12} className="text-emerald-500" />
            <span className="hidden sm:inline">Online Terminal</span>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          {/* Dashboard Button */}
          <button
            onClick={() => setIsDashboardOpen(true)}
            title="Session Dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition cursor-pointer"
          >
            <BarChart3 size={15} />
          </button>

          {/* User Profile Popover */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setIsProfileOpen((v) => !v)}
              title="Cashier Profile"
              className="flex h-8 items-center gap-2 rounded-xl bg-slate-100 border border-slate-200 pl-1.5 pr-2.5 text-slate-600 hover:bg-slate-200 transition cursor-pointer"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-white font-black text-[11px] shadow-sm">
                {cashierName ? cashierName.charAt(0).toUpperCase() : <User size={12} />}
              </div>
              <span className="hidden text-xs font-bold sm:block max-w-[80px] truncate">{cashierName || 'Cashier'}</span>
            </button>

            {/* Popover Dropdown */}
            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 rounded-2xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                {/* Profile Header */}
                <div className="px-4 py-3.5 bg-gradient-to-br from-slate-50 to-emerald-50 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white font-black text-base shadow-sm">
                      {cashierName ? cashierName.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{cashierName || 'Cashier'}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Store size={10} className="text-slate-400 shrink-0" />
                        <p className="text-[11px] text-slate-500 truncate">{showroomName}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-2">
                  <button
                    onClick={() => { setIsProfileOpen(false); setIsDashboardOpen(true) }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <span className="flex items-center gap-2"><BarChart3 size={14} className="text-emerald-500" /> Session Dashboard</span>
                    <ChevronRight size={13} className="text-slate-300" />
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    onClick={() => { setIsProfileOpen(false); onCloseSession() }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-orange-600 hover:bg-orange-50 transition cursor-pointer"
                  >
                    <LogOut size={14} />
                    <span>Close Session</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Terminal Body */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Category Sidebar: Slide-out on Mobile, Collapsible on Desktop */}
        <aside className={`
          absolute inset-y-0 left-0 z-30 bg-white border-r border-slate-200/80 transform transition-all duration-355 ease-in-out md:relative md:translate-x-0
          ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full'}
          ${isSidebarCollapsed ? 'md:w-0 md:opacity-0 md:pointer-events-none md:border-r-0' : 'md:w-64 md:opacity-100'}
        `}>
          <CategorySidebar 
            selectedCategoryId={selectedCategory} 
            onSelectCategory={(id) => {
              setSelectedCategory(id)
              setIsSidebarOpen(false) // auto close on mobile select
            }} 
          />
        </aside>

        {/* Backdrop for mobile sidebar */}
        {isSidebarOpen && (
          <div 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-slate-900/20 backdrop-blur-xs md:hidden"
          />
        )}

        {/* Central area: Search & Grid */}
        <main className="flex flex-1 flex-col overflow-hidden bg-slate-50/50">
          {/* Sticky Search bar row */}
          <div className="border-b border-slate-200/60 bg-white/70 px-4 py-3 backdrop-blur-xs md:px-6">
            <SearchBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchSubmit={handleSearchSubmit}
            />
          </div>

          {/* Product grid viewport */}
          <div className="flex-1 overflow-y-auto">
            <ProductGrid
              categoryId={selectedCategory}
              searchQuery={searchQuery}
              barcodeInput=""
              onBarcodeSubmit={() => {}}
            />
          </div>
        </main>

        {/* Cart Panel: Slide-out Drawer on Mobile, Fixed Panel on Desktop */}
        <aside className={`
          absolute inset-y-0 right-0 z-30 w-full max-w-md bg-white border-l border-slate-200/80 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:w-96 md:shrink-0
          ${isCartOpen ? 'translate-x-0' : 'translate-x-full'}
        `}>
          <CartPanel onCloseSession={onCloseSession} isMobileDrawer={true} onCloseDrawer={() => setIsCartOpen(false)} />
        </aside>

        {/* Backdrop for mobile cart */}
        {isCartOpen && (
          <div 
            onClick={() => setIsCartOpen(false)}
            className="absolute inset-0 z-20 bg-slate-900/20 backdrop-blur-xs md:hidden"
          />
        )}
      </div>

      {/* Floating Action Button (FAB) for Cart on Mobile */}
      <button
        onClick={() => setIsCartOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-slate-950 shadow-xl border border-emerald-400 hover:bg-emerald-400 hover:scale-105 active:scale-95 transition-all md:hidden cursor-pointer"
      >
        <div className="relative">
          <ShoppingCart size={22} />
          {items.length > 0 && (
            <span className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white border-2 border-slate-950 animate-bounce">
              {items.length}
            </span>
          )}
        </div>
      </button>

      {/* Variant selection modal for exact match lookup triggers */}
      <VariantModal 
        open={variantModalOpen}
        onOpenChange={setVariantModalOpen}
        product={selectedProduct}
        onAdd={handleAddVariant}
      />

      {/* Cashier Session Dashboard */}
      <CashierDashboard
        open={isDashboardOpen}
        onOpenChange={setIsDashboardOpen}
      />
    </div>
  )
}
