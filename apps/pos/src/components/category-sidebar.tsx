import { useEffect, useState } from 'react'
import { getCategoryTree } from '../api/client'
import { ChevronRight, ChevronDown, Layers } from 'lucide-react'

interface Props {
  selectedCategoryId: string | null
  onSelectCategory: (id: string | null) => void
}

export function CategorySidebar({ selectedCategoryId, onSelectCategory }: Props) {
  const [categories, setCategories] = useState<any[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    getCategoryTree().then((res) => setCategories(res.data || [])).catch(() => {})
  }, [])

  const expand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderNode = (node: any, depth: number = 0) => {
    const isSelected = selectedCategoryId === node.id
    const hasChildren = node.children && node.children.length > 0
    const isExpanded = expanded.has(node.id)

    return (
      <div key={node.id} className="w-full">
        <div
          className={`group flex w-full items-center justify-between transition border-l-2 ${
            isSelected 
              ? 'bg-emerald-500/10 border-emerald-500 text-emerald-800' 
              : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <button
            onClick={() => { onSelectCategory(node.id); if (hasChildren) expand(node.id) }}
            className="flex-1 px-3.5 py-2.5 text-left text-xs font-bold tracking-wide cursor-pointer"
            style={{ paddingLeft: `${14 + depth * 12}px` }}
          >
            {node.name}
          </button>
          
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.id)
              }}
              className="px-3 py-2 text-slate-400 hover:text-slate-700 cursor-pointer h-full flex items-center shrink-0"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
        {isExpanded && hasChildren && (
          <div className="border-l border-slate-100 ml-3 animate-in slide-in-from-top-1 duration-150">
            {node.children.map((child: any) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Title */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-slate-100">
        <Layers size={16} className="text-emerald-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Categories</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* All Products button */}
        <button
          onClick={() => onSelectCategory(null)}
          className={`flex w-full items-center px-4 py-2.5 text-left text-xs font-bold tracking-wide transition border-l-2 cursor-pointer ${
            !selectedCategoryId 
              ? 'bg-emerald-500/10 border-emerald-500 text-emerald-800' 
              : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          All Categories
        </button>
        {categories.map((cat) => renderNode(cat))}
      </div>
    </div>
  )
}
