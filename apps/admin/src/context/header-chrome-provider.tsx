import { createContext, useContext } from 'react'

/**
 * Tells child components that <Header> already renders the theme toggle and the
 * attendance clock on its behalf. Screens that still import <ThemeSwitch /> or
 * <ProfileDropdown /> directly read this and render nothing, which keeps the
 * top-right cluster to exactly one copy of each without touching ~90 screens.
 */
export const HeaderChromeContext = createContext(false)

export function useHeaderChrome(): boolean {
  return useContext(HeaderChromeContext)
}