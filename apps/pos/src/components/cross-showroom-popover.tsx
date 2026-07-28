import { useState } from 'react'
import { Store, Warehouse, MapPin } from 'lucide-react'

interface WarehouseStock {
  warehouseId: string
  warehouseName: string
  warehouseType: string
  stock: number
  available: number
}

interface CrossShowroomPopoverProps {
  productId: string
  variantId?: string
  currentShowroomName: string
  currentStock: number
  currentAvailable: number
  network: WarehouseStock[]
  showroomId: string
}

export function CrossShowroomPopover({
  currentShowroomName,
  currentStock,
  currentAvailable,
  network,
}: CrossShowroomPopoverProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition cursor-pointer"
      >
        View all locations →
      </button>
    )
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'showroom': return <Store size={14} className="shrink-0 text-blue-500" />
      case 'main': return <Warehouse size={14} className="shrink-0 text-purple-500" />
      default: return <MapPin size={14} className="shrink-0 text-slate-400" />
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg min-w-[220px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">Stock Availability</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          Close
        </button>
      </div>

      <div className="space-y-1.5">
        {/* Current showroom */}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Store size={14} className="shrink-0 text-emerald-500" />
            <span className="text-xs font-semibold text-slate-700 truncate">
              {currentShowroomName}
            </span>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              Current
            </span>
          </div>
          <span className="text-xs font-bold tabular-nums text-slate-800 ml-2 shrink-0">
            {currentAvailable} / {currentStock}
          </span>
        </div>

        {/* Other locations */}
        {network.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-2">
            Not available in any other location
          </p>
        ) : (
          network.map((w) => (
            <div
              key={w.warehouseId}
              className="flex items-center justify-between px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                {typeIcon(w.warehouseType)}
                <span className="text-xs text-slate-600 truncate">
                  {w.warehouseName}
                </span>
              </div>
              <span className="text-xs font-bold tabular-nums text-slate-800 ml-2 shrink-0">
                {w.available} / {w.stock}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
