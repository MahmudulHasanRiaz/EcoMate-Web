import React, { createContext, useContext, useState } from 'react'

export type PanelType = 'operational' | 'monitoring'

interface PanelContextType {
  activePanel: PanelType
  setActivePanel: (panel: PanelType) => void
}

const PanelContext = createContext<PanelContextType>({ activePanel: 'operational', setActivePanel: () => {} })

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [activePanel, setActivePanel] = useState<PanelType>('operational')
  return <PanelContext value={{ activePanel, setActivePanel }}>{children}</PanelContext>
}

export const usePanel = () => useContext(PanelContext)
