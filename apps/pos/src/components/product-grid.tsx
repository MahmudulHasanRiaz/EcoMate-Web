import { useEffect, useState, useCallback } from 'react'
import { getPosProducts } from '../api/client'
import { useCartStore } from '../stores/cart-store'
import { Search } from 'lucide-react'

interface Props {
  categoryId: string | null
  searchQuery: string
  barcodeInput: string
  onBarcodeSubmit: () => void
}

export function ProductGrid({ categoryId, searchQuery, barcodeInput, onBarcodeSubmit }: Props) {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const addItem = useCartStore((s) => s.addItem)

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { perPage: 100 }
      if (categoryId) params.categoryId = categoryId
      if (searchQuery) params.search = searchQuery
      if (barcodeInput) params.barcode = barcodeInput
      const res = await getPosProducts(params)
      // Response is { data: [...], total, page, perPage }
      setProducts(res.data.data || [])
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [categoryId, searchQuery, barcodeInput])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const handleAdd = (product: any) => {
    const price = Number(product.salePrice || product.basePrice || 0)
    if (!price) return
    addItem({
      productId: product.id,
      name: product.name,
      sku: product.sku || undefined,
      price,
      quantity: 1,
    })
  }

  if (loading) return <div className="flex items-center justify-center p-8 text-gray-400">Loading products...</div>

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-400">
        <Search size={48} className="mb-4 opacity-30" />
        <p className="text-lg">Search products or scan barcode</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3 overflow-y-auto p-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {products.map((p: any) => {
        const images = Array.isArray(p.images) ? p.images : []
        const imgUrl = images[0]?.url || images[0] || null
        const price = Number(p.salePrice || p.basePrice || 0)
        return (
          <button
            key={p.id}
            onClick={() => handleAdd(p)}
            className="flex flex-col items-center rounded-xl bg-white p-3 shadow transition hover:shadow-md hover:ring-2 hover:ring-green-400 active:scale-95"
          >
            {imgUrl ? (
              <img src={imgUrl} alt={p.name} className="mb-2 h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="mb-2 flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                <Search size={24} />
              </div>
            )}
            <p className="line-clamp-2 text-center text-xs font-medium">{p.name}</p>
            <p className="mt-1 text-sm font-bold text-green-700">
              ৳{price.toLocaleString()}
            </p>
          </button>
        )
      })}
    </div>
  )
}
