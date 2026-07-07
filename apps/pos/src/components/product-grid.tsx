import { useEffect, useState, useCallback } from 'react'
import { getPosProducts } from '../api/client'
import { useCartStore } from '../stores/cart-store'
import { Search, Plus, Layers } from 'lucide-react'
import { VariantModal } from './variant-modal'

interface Props {
  categoryId: string | null
  searchQuery: string
  barcodeInput: string
  onBarcodeSubmit: () => void
}

export function ProductGrid({ categoryId, searchQuery, barcodeInput, onBarcodeSubmit }: Props) {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [variantModalOpen, setVariantModalOpen] = useState(false)
  const addItem = useCartStore((s) => s.addItem)

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { perPage: 100 }
      if (categoryId) params.categoryId = categoryId
      if (searchQuery) params.search = searchQuery
      if (barcodeInput) params.barcode = barcodeInput
      const res = await getPosProducts(params)
      setProducts(res.data.data || [])
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [categoryId, searchQuery, barcodeInput])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const handleProductClick = (product: any) => {
    if (product.type === 'variable' && product.variants && product.variants.length > 0) {
      setSelectedProduct(product)
      setVariantModalOpen(true)
      return
    }

    const price = Number(product.salePrice || product.basePrice || 0)
    if (!price) return
    const images = Array.isArray(product.images) ? product.images : []
    const imgUrl = images[0]?.url || images[0] || null
    addItem({
      productId: product.id,
      name: product.name,
      sku: product.sku || undefined,
      price,
      quantity: 1,
      image: imgUrl || undefined,
    })
  }

  const handleAddVariant = (variant: any, variantName: string) => {
    const price = Number(variant.salePrice || variant.price || 0)
    if (!price || !selectedProduct) return
    const parentImages = Array.isArray(selectedProduct.images) ? selectedProduct.images : []
    const parentImgUrl = parentImages[0]?.url || parentImages[0] || null
    const imgUrl = variant.image || parentImgUrl || null
    addItem({
      productId: selectedProduct.id,
      variantId: variant.id,
      name: `${selectedProduct.name} (${variantName})`,
      sku: variant.sku || selectedProduct.sku || undefined,
      price,
      quantity: 1,
      image: imgUrl || undefined,
    })
  }

  const getProductPriceDisplay = (p: any) => {
    if (p.type === 'variable' && p.variants && p.variants.length > 0) {
      const prices = p.variants
        .map((v: any) => Number(v.salePrice || v.price || 0))
        .filter((pr: number) => pr > 0)
      if (prices.length > 0) {
        const minPrice = Math.min(...prices)
        const maxPrice = Math.max(...prices)
        if (minPrice === maxPrice) {
          return `৳${minPrice.toLocaleString()}`
        }
        return `৳${minPrice.toLocaleString()} - ৳${maxPrice.toLocaleString()}`
      }
    }
    const price = Number(p.salePrice || p.basePrice || 0)
    return `৳${price.toLocaleString()}`
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 animate-pulse">
        {Array.from({ length: 12 }).map((_, idx) => (
          <div key={idx} className="flex flex-col items-center rounded-2xl bg-white p-4 border border-slate-100 shadow-xs">
            <div className="mb-3 w-full aspect-square max-w-[96px] rounded-xl bg-slate-100" />
            <div className="h-3 w-16 rounded bg-slate-100" />
            <div className="mt-2 h-4 w-12 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4 border border-slate-200/60">
          <Search size={28} className="opacity-60" />
        </div>
        <h3 className="text-base font-bold text-slate-700">No products found</h3>
        <p className="mt-1 text-sm text-slate-400 max-w-xs">
          Try adjusting your search criteria, scanning a different barcode, or selecting another category.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {products.map((p: any) => {
          const images = Array.isArray(p.images) ? p.images : []
          const imgUrl = images[0]?.url || images[0] || null
          const isVariable = p.type === 'variable' && p.variants && p.variants.length > 0
          
          return (
            <button
              key={p.id}
              onClick={() => handleProductClick(p)}
              className="group relative flex flex-col items-stretch overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-xs hover:border-emerald-500/30 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer pb-3.5"
            >
              {/* Type Indicator Tag */}
              {isVariable && (
                <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 border border-emerald-100/80 shadow-xs">
                  <Layers size={10} />
                  <span>Variable</span>
                </div>
              )}

              {/* Hover Action Badge */}
              <div className="absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-slate-950 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                <Plus size={14} />
              </div>

              {/* Product Image or Fallback - Edge-to-edge full width */}
              <div className="w-full aspect-square bg-slate-50 overflow-hidden relative flex items-center justify-center border-b border-slate-100">
                {imgUrl ? (
                  <img src={imgUrl} alt={p.name} className="h-full w-full object-cover transition duration-350 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300">
                    <Search size={26} className="opacity-45" />
                  </div>
                )}
              </div>

              {/* Product Meta padding */}
              <div className="px-3 pt-2.5 flex flex-col items-center flex-1">
                <p className="line-clamp-2 text-center text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors min-h-[2rem]">
                  {p.name}
                </p>
                <p className="mt-2 text-xs font-black text-emerald-600">
                  {getProductPriceDisplay(p)}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      <VariantModal 
        open={variantModalOpen}
        onOpenChange={setVariantModalOpen}
        product={selectedProduct}
        onAdd={handleAddVariant}
      />
    </>
  )
}
