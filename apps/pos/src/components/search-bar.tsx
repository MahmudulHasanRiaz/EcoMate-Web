import { useRef, useEffect } from 'react'
import { Search, Barcode, X } from 'lucide-react'

interface Props {
  searchQuery: string
  onSearchChange: (q: string) => void
  onSearchSubmit: () => void
}

export function SearchBar({ searchQuery, onSearchChange, onSearchSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2' || (e.ctrlKey && e.key === 'f')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="relative w-full">
      {/* Search Icon */}
      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      
      {/* Combined Input Field */}
      <input
        ref={inputRef}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-24 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
        placeholder="Search products by name, SKU or scan barcode..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSearchSubmit()
          }
        }}
        autoFocus
      />

      {/* Right Inner Badges & Clear button */}
      <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
        {searchQuery && (
          <button 
            type="button"
            onClick={() => onSearchChange('')}
            className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
          >
            <X size={14} />
          </button>
        )}
        <div 
          className="flex items-center gap-1 bg-slate-200/80 rounded px-1.5 py-0.5 text-[9px] font-black text-slate-500 uppercase tracking-wide cursor-help"
          title="F2 focuses search for scan"
        >
          <Barcode size={10} />
          <span>F2</span>
        </div>
      </div>
    </div>
  )
}
