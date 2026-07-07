import * as Dialog from '@radix-ui/react-dialog'
import { X, ShoppingCart, Layers } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: any
  onAdd: (variant: any, variantName: string) => void
}

export function VariantModal({ open, onOpenChange, product, onAdd }: Props) {
  if (!product || !product.variants || product.variants.length === 0) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 outline-none animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <Dialog.Title className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Layers size={18} className="text-emerald-500" />
              <span>Select Variant</span>
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition cursor-pointer">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Product Name */}
          <div className="mb-4">
            <h3 className="text-sm font-black text-slate-800">{product.name}</h3>
            {product.sku && <p className="text-[10px] font-semibold text-slate-400 mt-0.5">Parent SKU: {product.sku}</p>}
          </div>

          {/* Variant List */}
          <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
            {product.variants.map((v: any) => {
              // Construct variant display name from its attribute values
              const variantName = v.attributeValues
                ?.map((av: any) => av.attributeValue?.value)
                .join(' / ') || v.sku || 'Default Variant'

              const price = Number(v.salePrice || v.price || 0)
              const hasStock = v.stock > 0

              const parentImages = Array.isArray(product.images) ? product.images : []
              const parentImgUrl = parentImages[0]?.url || parentImages[0] || null
              const variantImgUrl = v.image || parentImgUrl || null

              return (
                <div 
                  key={v.id} 
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 hover:border-emerald-500/20 hover:bg-slate-50 transition-all"
                >
                  {/* Thumbnail image */}
                  {variantImgUrl ? (
                    <div className="h-10 w-10 overflow-hidden rounded-lg border border-slate-200 bg-white shrink-0">
                      <img src={variantImgUrl} alt={variantName} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
                      <Layers size={14} className="opacity-40" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{variantName}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] font-semibold">
                      <span className="text-slate-400">SKU: {v.sku}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-200" />
                      <span className={hasStock ? 'text-emerald-600' : 'text-rose-500'}>
                        {hasStock ? `${v.stock} in stock` : 'Out of stock'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-black text-slate-900">৳{price.toLocaleString()}</span>
                    <button
                      onClick={() => {
                        onAdd(v, variantName)
                        onOpenChange(false)
                      }}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 transition cursor-pointer active:scale-95 shadow-xs border border-emerald-400"
                    >
                      <ShoppingCart size={12} />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cancel button */}
          <div className="mt-6">
            <Dialog.Close className="w-full rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 transition text-center block cursor-pointer">
              Cancel
            </Dialog.Close>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
