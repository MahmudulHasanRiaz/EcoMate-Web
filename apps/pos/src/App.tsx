import { useState, useEffect } from 'react'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/login'
import { SessionSelectPage } from './pages/session-select'
import { SessionOpenPage } from './pages/session-open'
import { PosTerminalPage } from './pages/pos-terminal'
import { SessionClosePage } from './pages/session-close'
import { useSessionStore } from './stores/session-store'

type Page = 'login' | 'session-select' | 'session-open' | 'pos' | 'session-close'

export function App() {
  const [page, setPage] = useState<Page>('login')
  const { sessionId } = useSessionStore()
  const token = localStorage.getItem('pos_access_token')

  useEffect(() => {
    if (!token) {
      setPage('login')
      return
    }
    if (sessionId) {
      setPage('pos')
      return
    }
    // No open session: only leave the login page on a cold start. Picking a
    // showroom stores sessionId as '' before the drawer opens, so downgrading
    // unconditionally here would bounce the user straight back to this screen.
    // sessionId === null means the showroom choice itself was cleared (Back),
    // which really must return to the picker.
    setPage((prev) => {
      if (prev === 'login' || prev === 'pos') return 'session-select'
      if (prev === 'session-open' && sessionId === null) return 'session-select'
      return prev
    })
  }, [token, sessionId])

  return (
    <>
      <Toaster position="top-center" />
      {page === 'login' && <LoginPage onSuccess={() => setPage('session-select')} />}
      {page === 'session-select' && <SessionSelectPage onSelected={() => setPage('session-open')} />}
      {page === 'session-open' && <SessionOpenPage onOpened={() => setPage('pos')} />}
      {page === 'pos' && <PosTerminalPage onCloseSession={() => setPage('session-close')} />}
      {page === 'session-close' && <SessionClosePage onClosed={() => { localStorage.removeItem('pos_access_token'); setPage('login') }} />}
    </>
  )
}
