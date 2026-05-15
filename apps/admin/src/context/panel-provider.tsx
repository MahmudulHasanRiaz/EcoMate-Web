import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'

export type PanelType = 'operational' | 'monitoring'

interface PanelContextType {
  activePanel: PanelType
  setActivePanel: (panel: PanelType) => void
}

const PanelContext = createContext<PanelContextType>({ activePanel: 'operational', setActivePanel: () => {} })

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [activePanel, setActivePanel] = useState<PanelType>('operational')
  const routerState = useRouterState()

  useEffect(() => {
    const loc = routerState.location.pathname
    if (loc.includes('/mon/') || loc.includes('/mon')) {
      setActivePanel('monitoring')
    } else if (loc.includes('/op/') || loc.includes('/op') || loc === '/' || loc === '/admin/') {
      setActivePanel('operational')
    }
  }, [routerState.location.pathname])

  return <PanelContext value={{ activePanel, setActivePanel }}>{children}</PanelContext>
}

export const usePanel = () => useContext(PanelContext)
