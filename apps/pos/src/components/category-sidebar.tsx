import { useEffect, useState } from 'react'
import { getCategoryTree } from '../api/client'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Props {
  selectedCategoryId: string | null
  onSelectCategory: (id: string | null) => void
}

export function CategorySidebar({ selectedCategoryId, onSelectCategory }: Props) {
  const [categories, setCategories] = useState<any[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    getCategoryTree().then((res) => setCategories(res.data)).catch(() => {})
  }, [])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderNode = (node: any, depth: number = 0) => (
    <div key={node.id}>
      <button
        onClick={() => { onSelectCategory(node.id); toggle(node.id) }}
        className={`flex w-full items-center gap-1 px-3 py-2 text-left text-sm transition ${
          selectedCategoryId === node.id ? 'bg-green-100 font-semibold text-green-800' : 'hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {node.children?.length > 0 && (
          expanded.has(node.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        )}
        <span>{node.name}</span>
      </button>
      {expanded.has(node.id) && node.children?.map((child: any) => renderNode(child, depth + 1))}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto border-r bg-white">
      <button
        onClick={() => onSelectCategory(null)}
        className={`w-full px-3 py-2 text-left text-sm font-medium transition ${
          !selectedCategoryId ? 'bg-green-100 text-green-800' : 'hover:bg-gray-100'
        }`}
      >
        All Products
      </button>
      {categories.map((cat) => renderNode(cat))}
    </div>
  )
}
