import { useRef, useEffect } from 'react'
import { Search, Barcode } from 'lucide-react'

interface Props {
  searchQuery: string
  onSearchChange: (q: string) => void
  barcodeInput: string
  onBarcodeChange: (barcode: string) => void
  onBarcodeSubmit: () => void
}

export function SearchBar({ searchQuery, onSearchChange, barcodeInput, onBarcodeChange, onBarcodeSubmit }: Props) {
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2' || (e.ctrlKey && e.key === 'f')) {
        e.preventDefault()
        barcodeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-base"
          placeholder="Search products by name, SKU..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="relative w-48">
        <Barcode size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={barcodeRef}
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-base"
          placeholder="Scan barcode"
          value={barcodeInput}
          onChange={(e) => onBarcodeChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onBarcodeSubmit() }}
        />
      </div>
    </div>
  )
}
