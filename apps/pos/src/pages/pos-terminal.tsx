import { useState } from 'react'
import { CategorySidebar } from '../components/category-sidebar'
import { ProductGrid } from '../components/product-grid'
import { SearchBar } from '../components/search-bar'
import { CartPanel } from '../components/cart-panel'
import { useSessionStore } from '../stores/session-store'

interface Props { onCloseSession: () => void }

export function PosTerminalPage({ onCloseSession }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const { showroomName } = useSessionStore()

  const handleBarcodeSubmit = () => {
    // barcode is already bound to state, triggers refetch
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-green-700">EcoMate POS</h1>
          <span className="text-sm text-gray-500">{showroomName}</span>
        </div>
      </header>

      {/* Search bar */}
      <div className="border-b bg-gray-50 px-4 py-2">
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          barcodeInput={barcodeInput}
          onBarcodeChange={setBarcodeInput}
          onBarcodeSubmit={handleBarcodeSubmit}
        />
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Category sidebar */}
        <div className="w-56 shrink-0">
          <CategorySidebar selectedCategoryId={selectedCategory} onSelectCategory={setSelectedCategory} />
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-hidden">
          <ProductGrid
            categoryId={selectedCategory}
            searchQuery={searchQuery}
            barcodeInput={barcodeInput}
            onBarcodeSubmit={handleBarcodeSubmit}
          />
        </div>

        {/* Cart panel */}
        <div className="w-96 shrink-0">
          <CartPanel onCloseSession={onCloseSession} />
        </div>
      </div>
    </div>
  )
}
