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
    if (!token) setPage('login')
    else if (!sessionId) setPage('session-select')
    else setPage('pos')
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
