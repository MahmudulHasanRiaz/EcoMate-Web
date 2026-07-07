import { useEffect, useState } from 'react'
import { getShowrooms } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { MapPin, Phone, Building2, Search, LogOut, ArrowRight, Loader2 } from 'lucide-react'

interface Props { onSelected: () => void }

export function SessionSelectPage({ onSelected }: Props) {
  const [showrooms, setShowrooms] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getShowrooms()
      .then((res) => {
        console.log('POS: Showrooms fetched:', res.data)
        setShowrooms(res.data || [])
      })
      .catch((err) => {
        console.error('POS: Error fetching showrooms:', err?.response?.data || err?.message || err)
      })
      .finally(() => setLoading(false))
  }, [])

  const selectShowroom = (showroom: any) => {
    useSessionStore.getState().setSession({
      id: '',
      showroomId: showroom.id,
      showroomName: showroom.name,
      cashierName: '',
    })
    onSelected()
  }

  const handleLogout = () => {
    localStorage.removeItem('pos_access_token')
    localStorage.removeItem('pos_session_id')
    window.location.href = '/pos/'
  }

  const filteredShowrooms = showrooms.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (s.city && s.city.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
        <span className="mt-4 text-sm font-medium tracking-wide">Loading showrooms...</span>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 p-6">
      {/* Decorative background gradients */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-emerald-500/5 blur-[120px]" />
      <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-teal-500/5 blur-[120px]" />

      <div className="relative z-10 w-full max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">Select Showroom</h1>
            <p className="mt-1.5 text-sm text-slate-400">Choose a physical terminal to open your session</p>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100 active:scale-[0.98] transition cursor-pointer"
          >
            <LogOut size={14} />
            <span>Log out</span>
          </button>
        </div>

        {showrooms.length > 0 && (
          <div className="relative mb-6">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search by showroom name or location..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        <div className="max-h-[50vh] space-y-3.5 overflow-y-auto pr-1">
          {filteredShowrooms.length === 0 ? (
            <div className="glass-dark rounded-2xl p-10 text-center border border-slate-800">
              <Building2 size={40} className="mx-auto mb-3.5 text-slate-600" />
              <h3 className="text-base font-semibold text-slate-300">No Showrooms Found</h3>
              <p className="mt-1 text-sm text-slate-500 max-w-xs mx-auto">
                Create a warehouse with type "showroom" and activate it in the admin panel first.
              </p>
            </div>
          ) : (
            filteredShowrooms.map((s) => (
              <button
                key={s.id}
                onClick={() => selectShowroom(s)}
                className="glass-dark group flex w-full items-center justify-between rounded-2xl p-5 text-left transition hover:border-emerald-500/40 hover:bg-slate-900/40 active:scale-[0.99] cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 group-hover:text-emerald-300 transition">
                    <Building2 size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100 group-hover:text-emerald-400 transition">{s.name}</h3>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      {s.address && (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} className="text-slate-500" />
                          <span>{s.address}</span>
                        </span>
                      )}
                      {s.phone && (
                        <span className="flex items-center gap-1">
                          <Phone size={12} className="text-slate-500" />
                          <span>{s.phone}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-slate-400 border border-slate-800 opacity-0 group-hover:opacity-100 group-hover:bg-emerald-500 group-hover:text-slate-950 group-hover:border-emerald-500 transition-all duration-200">
                  <ArrowRight size={14} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
