import { useEffect, useState } from 'react'
import { getShowrooms } from '../api/client'
import { useSessionStore } from '../stores/session-store'

interface Props { onSelected: () => void }

export function SessionSelectPage({ onSelected }: Props) {
  const [showrooms, setShowrooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getShowrooms()
      .then((res) => {
        console.log('POS: Showrooms fetched:', res.data)
        setShowrooms(res.data)
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

  if (loading) return <div className="flex h-screen items-center justify-center text-xl text-gray-500">Loading...</div>

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <h1 className="mb-8 text-2xl font-bold text-gray-800">Select Showroom</h1>
      <div className="grid w-full max-w-lg gap-4">
        {showrooms.length === 0 && (
          <p className="text-center text-gray-400">No showrooms found. Create a Warehouse with type "showroom" first.</p>
        )}
        {showrooms.map((s) => (
          <button
            key={s.id}
            onClick={() => selectShowroom(s)}
            className="rounded-xl bg-white p-6 text-left text-lg font-semibold shadow-lg transition hover:shadow-xl hover:ring-2 hover:ring-green-500"
          >
            {s.name}
            {s.address && <p className="mt-1 text-sm font-normal text-gray-500">{s.address}</p>}
          </button>
        ))}
      </div>
    </div>
  )
}
