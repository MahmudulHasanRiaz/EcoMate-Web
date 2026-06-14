'use client'

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search as SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { WidgetShell } from '../components/WidgetShell'
import type { WidgetProps } from '../types'

export function QuickOrderSearch(_props: WidgetProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const handleSearch = () => {
    if (!query.trim()) return
    navigate({ to: '/op/orders', search: { search: query.trim() } as never })
  }

  return (
    <WidgetShell title="Quick Search" description="Find order by ID or phone" isLoading={false}>
      <div className="flex gap-2">
        <Input
          placeholder="Order ID or phone number..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch}><SearchIcon className="h-4 w-4" /></Button>
      </div>
    </WidgetShell>
  )
}
