import React, { useState } from 'react'
import useDialogState from '@/hooks/use-dialog-state'
import { type ProductResponse } from '../api'

type ProductsDialogType = 'add' | 'edit' | 'delete'

type ProductsContextType = {
  open: ProductsDialogType | null
  setOpen: (str: ProductsDialogType | null) => void
  currentRow: ProductResponse | null
  setCurrentRow: React.Dispatch<React.SetStateAction<ProductResponse | null>>
}

const ProductsContext = React.createContext<ProductsContextType | null>(null)

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<ProductsDialogType>(null)
  const [currentRow, setCurrentRow] = useState<ProductResponse | null>(null)

  return (
    <ProductsContext value={{ open, setOpen, currentRow, setCurrentRow }}>
      {children}
    </ProductsContext>
  )
}

export const useProducts = () => {
  const productsContext = React.useContext(ProductsContext)

  if (!productsContext) {
    throw new Error('useProducts has to be used within <ProductsContext>')
  }

  return productsContext
}
