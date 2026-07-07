import { useState } from 'react'
import { CategorySidebar } from '../components/category-sidebar'
import { ProductGrid } from '../components/product-grid'
import { SearchBar } from '../components/search-bar'
import { CartPanel } from '../components/cart-panel'
import { useSessionStore } from '../stores/session-store'
import { useCartStore } from '../stores/cart-store'
import { getPosProducts } from '../api/client'
import { VariantModal } from '../components/variant-modal'
import { toast } from 'sonner'
import { LogOut, ShoppingCart, User, Wifi, Menu, X } from 'lucide-react'

interface Props { onCloseSession: () => void }

export function PosTerminalPage({ onCloseSession }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)
  
  // States for parent-level exact-match variant modal triggering
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [variantModalOpen, setVariantModalOpen] = useState(false)
  
  const { showroomName } = useSessionStore()
  const { items } = useCartStore()

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

        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 transition">
            <Wifi size={12} className="text-emerald-500" />
            <span className="hidden sm:inline">Online Terminal</span>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          {/* User profile / Logout */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600 border border-slate-200">
              <User size={16} />
            </div>
            <button 
              onClick={onCloseSession}
              className="flex items-center gap-1.5 rounded-xl border border-orange-200/80 bg-orange-50/50 px-3 py-1.5 text-xs font-bold text-orange-600 hover:bg-orange-100 hover:text-orange-700 active:scale-[0.98] transition cursor-pointer"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Close Session</span>
            </button>
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
    </div>
  )
}
