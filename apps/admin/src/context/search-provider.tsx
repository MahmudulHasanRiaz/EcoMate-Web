import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { CommandPalette } from '@/components/command-palette'

interface SearchResultItem {
  id: string
  displayId?: string
  name?: string
  total?: number
  status?: string
  customerName?: string
  phone?: string
  sku?: string
  price?: number
  email?: string
}

interface SearchResults {
  orders: SearchResultItem[]
  products: SearchResultItem[]
  customers: SearchResultItem[]
}

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  results: SearchResults
  isLoading: boolean
  error: string | null
  recentSearches: string[]
  search: (q: string) => void
  clearRecentSearches: () => void
  addRecentSearch: (q: string) => void
}

const SearchContext = createContext<SearchContextType | null>(null)

const RECENT_SEARCHES_KEY = 'global-search-recent'
const MAX_RECENT = 5

function loadRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentSearches(items: string[]) {
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items))
}

type SearchProviderProps = {
  children: React.ReactNode
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>({
    orders: [],
    products: [],
    customers: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>(
    loadRecentSearches,
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({ orders: [], products: [], customers: [] })
      setError(null)
    }
  }, [open])

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (q.length < 2) {
      setResults({ orders: [], products: [], customers: [] })
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get<SearchResults>('/admin/search', {
          params: { q, limit: 5 },
        })
        setResults(res.data)
      } catch {
        setError('Search unavailable')
        setResults({ orders: [], products: [], customers: [] })
      } finally {
        setIsLoading(false)
      }
    }, 300)
  }

  const addRecentSearch = (q: string) => {
    setRecentSearches((prev) => {
      const next = [q, ...prev.filter((s) => s !== q)].slice(0, MAX_RECENT)
      saveRecentSearches(next)
      return next
    })
  }

  const clearRecentSearches = () => {
    setRecentSearches([])
    saveRecentSearches([])
  }

  return (
    <SearchContext
      value={{
        open,
        setOpen,
        query,
        setQuery,
        results,
        isLoading,
        error,
        recentSearches,
        search,
        clearRecentSearches,
        addRecentSearch,
      }}
    >
      {children}
      <CommandPalette />
    </SearchContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSearch = () => {
  const searchContext = useContext(SearchContext)
  if (!searchContext) {
    throw new Error('useSearch has to be used within SearchProvider')
  }
  return searchContext
}
