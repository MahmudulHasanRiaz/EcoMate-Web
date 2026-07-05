import { useEffect, useCallback, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { usePackingQueue, usePackingStats, useOpenOrder, useMarkDone, useMarkHold, usePackingHistory, useReleaseLock, useCheckOrderStatus } from './hooks'
import { StatsBar } from './StatsBar'
import { HoldModal } from './HoldModal'
import { Input } from '@/components/ui/input'
import { Html5Qrcode } from 'html5-qrcode'
import { SafeImage } from '@/components/safe-image'
import { toast } from 'sonner'
import { 
  Camera, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronLeft, 
  Scan, 
  ChevronRight, 
  Info, 
  Lock, 
  Printer, 
  Play, 
  Pause, 
  LogOut, 
  Package, 
  RefreshCw, 
  Clock, 
  Check, 
  ExternalLink,
  Search,
  Maximize2,
  X
} from 'lucide-react'
import type { QueueItem, HoldFormData } from './types'

type TabType = 'scan' | 'packed' | 'held'

export function PackingWorkspace() {
  const currentUser = useAuthStore((s) => s.auth.user)
  const currentPackerId = currentUser?.id ?? ''
  const currentPackerRole = currentUser?.role ?? 'packing_assistant'

  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabType>('scan')
  
  // Packing state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [holdOrderId, setHoldOrderId] = useState<string | null>(null)
  const [showCustomerDetails, setShowCustomerDetails] = useState(false)
  const [verifiedQuantities, setVerifiedQuantities] = useState<Record<string, number>>({})
  const [currentProductIdx, setCurrentProductIdx] = useState(0)
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [manualSearch, setManualSearch] = useState('')
  const [showManualSearch, setShowManualSearch] = useState(false)

  const [verificationMode, setVerificationMode] = useState<'strict_scan' | 'manual_allowed'>('strict_scan')

  const handleSetVerificationMode = useCallback((mode: 'strict_scan' | 'manual_allowed') => {
    setVerificationMode(mode)
    toast.success(`Verification mode set to: ${mode === 'strict_scan' ? 'Strict Scan' : 'Manual'}`)
  }, [])

  // Modal logs viewer states
  const [viewedPackedOrder, setViewedPackedOrder] = useState<any | null>(null)
  const [viewedHeldOrder, setViewedHeldOrder] = useState<any | null>(null)

  // Camera scanner states
  const [scannerActive, setScannerActive] = useState(true)
  const [cameras, setCameras] = useState<any[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [scannerError, setScannerError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // Load verifiedQuantities from localStorage when order changes
  useEffect(() => {
    if (!selectedOrderId) {
      setVerifiedQuantities({})
      return
    }
    const saved = localStorage.getItem(`packing_checklist_:${selectedOrderId}`)
    if (saved) {
      try {
        setVerifiedQuantities(JSON.parse(saved))
      } catch (err) {
        console.error("Failed to parse saved checklist items", err)
        setVerifiedQuantities({})
      }
    } else {
      setVerifiedQuantities({})
    }
  }, [selectedOrderId])

  // Save verifiedQuantities to localStorage when verifiedQuantities changes
  useEffect(() => {
    if (!selectedOrderId) return
    if (Object.keys(verifiedQuantities).length === 0) {
      localStorage.removeItem(`packing_checklist_:${selectedOrderId}`)
    } else {
      localStorage.setItem(`packing_checklist_:${selectedOrderId}`, JSON.stringify(verifiedQuantities))
    }
  }, [verifiedQuantities, selectedOrderId])

  // Queries & Mutations
  const { data: queue = [], isLoading: isQueueLoading } = usePackingQueue()
  const { data: stats } = usePackingStats()
  const { data: history = [], isLoading: isHistoryLoading } = usePackingHistory(currentPackerId)

  const openOrder = useOpenOrder()
  const markDone = useMarkDone()
  const markHold = useMarkHold()
  const releaseLock = useReleaseLock()
  const checkStatus = useCheckOrderStatus()

  const activeOrder = queue.find((o) => o.id === selectedOrderId)

  // Open and lock order
  const openAndSelect = useCallback(async (order: QueueItem) => {
    if (order.packingLock && order.packingLock.packerId !== currentPackerId) {
      toast.error(`This order is being packed by ${order.packingLock.packerName}`)
      return
    }
    try {
      await openOrder.mutateAsync(order.id)
      setSelectedOrderId(order.id)
      setCurrentProductIdx(0)
      setShowCustomerDetails(false)
      toast.success(`Loaded Order ${order.displayId}`)
    } catch (err: any) {
      const errMsg = err.response?.data?.message || "Failed to lock order. It may be locked by another user."
      toast.error(errMsg)
    }
  }, [openOrder, currentPackerId])

  // Release lock on back
  const handleBackAndRelease = useCallback(async () => {
    if (selectedOrderId) {
      localStorage.removeItem(`packing_checklist_:${selectedOrderId}`)
      try {
        await releaseLock.mutateAsync(selectedOrderId)
      } catch (err) {
        console.error("Failed to release lock on exit", err)
      }
      setSelectedOrderId(null)
    }
  }, [selectedOrderId, releaseLock])

  // Scan success trigger
  const onScanSuccess = useCallback(async (decodedText: string) => {
    // Search in the active queue (contains both Confirmed & Packing Hold statuses!)
    const matched = queue.find((o) => 
      o.id.toLowerCase() === decodedText.toLowerCase() ||
      o.displayId.toLowerCase() === decodedText.toLowerCase()
    )

    if (matched) {
      if (navigator.vibrate) navigator.vibrate(100)
      openAndSelect(matched)
    } else {
      try {
        const res = await checkStatus.mutateAsync(decodedText)
        if (res.exists) {
          const orderStatus = res.status || ''
          const orderDisplayId = res.displayId || decodedText

          if (orderStatus.toLowerCase() === 'packed' || orderStatus.toLowerCase() === 'shipped' || orderStatus.toLowerCase() === 'delivered') {
            if (navigator.vibrate) navigator.vibrate([150, 100, 150])
            toast.error(`Order "${orderDisplayId}" is already packed (current status: ${orderStatus}).`, {
              position: 'top-center',
              duration: 5000
            })
          } else {
            if (navigator.vibrate) navigator.vibrate([150, 100, 150])
            toast.error(`Order "${orderDisplayId}" is not ready for packing (current status: ${orderStatus}).`, {
              position: 'top-center',
              duration: 5000
            })
          }
        } else {
          if (navigator.vibrate) navigator.vibrate([50, 50, 50])
          toast.error(`Order "${decodedText}" was not found in the system.`, {
            position: 'top-center'
          })
        }
      } catch (err) {
        console.error("Failed to check order status", err)
        if (navigator.vibrate) navigator.vibrate([50, 50, 50])
        toast.error(`Order "${decodedText}" was not found in the system.`, {
          position: 'top-center'
        })
      }
    }
  }, [queue, openAndSelect, checkStatus])

  // Get cameras list on mount
  useEffect(() => {
    Html5Qrcode.getCameras()
      .then(devices => {
        if (devices && devices.length > 0) {
          setCameras(devices)
          // Default to environment back camera if possible
          const backCam = devices.find(d => 
            d.label.toLowerCase().includes('back') || 
            d.label.toLowerCase().includes('environment') ||
            d.label.toLowerCase().includes('rear')
          )
          setSelectedCameraId(backCam ? backCam.id : devices[0].id)
        } else {
          setScannerError("No cameras detected on this device.")
        }
      })
      .catch(err => {
        console.error("Camera detection error", err)
        setScannerError("Camera permission denied or unavailable.")
      })
  }, [])

  // Camera start/stop controller
  useEffect(() => {
    // Only run if active tab is scan, no order details drawer is open, and scanner is toggled active
    if (activeTab !== 'scan' || selectedOrderId || !scannerActive || !selectedCameraId) {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop()
          .then(() => {
            scannerRef.current = null
          })
          .catch(err => console.error("Error stopping scanner", err))
      }
      return
    }

    const scannerId = "scanner-viewport"
    const element = document.getElementById(scannerId)
    if (!element) return

    const html5QrCode = new Html5Qrcode(scannerId)
    scannerRef.current = html5QrCode

    const config = { 
      fps: 15, 
      qrbox: (width: number, height: number) => {
        const size = Math.min(width, height) * 0.75
        return { width: size, height: size }
      }
    }

    html5QrCode.start(
      selectedCameraId,
      config,
      (decodedText) => {
        onScanSuccess(decodedText)
      },
      () => {
        // Quiet error callbacks to prevent console spamming
      }
    ).catch(err => {
      console.error("Failed to start html5-qrcode", err)
      setScannerError("Camera is currently in use or not responding.")
    })

    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop()
          .then(() => {
            scannerRef.current = null
          })
          .catch(err => console.error("Error stopping on clean up", err))
      }
    }
  }, [activeTab, selectedOrderId, scannerActive, selectedCameraId, onScanSuccess])

  const handleDone = useCallback(async (orderId: string) => {
    localStorage.removeItem(`packing_checklist_:${orderId}`)
    try {
      await markDone.mutateAsync({ orderId, verificationMode })
      setSelectedOrderId(null)
      setManualSearch('')
      toast.success("Order packed successfully!")
      // Automatically triggers camera restart
    } catch {
      toast.error("Failed to complete packing.")
    }
  }, [markDone, verificationMode])

  const handleHold = useCallback((orderId: string) => {
    setHoldOrderId(orderId)
  }, [])

  const handleHoldSubmit = useCallback(async (data: HoldFormData) => {
    if (!holdOrderId) return
    localStorage.removeItem(`packing_checklist_:${holdOrderId}`)
    try {
      await markHold.mutateAsync({ orderId: holdOrderId, data })
      setHoldOrderId(null)
      setSelectedOrderId(null)
      setManualSearch('')
      toast.success("Order placed on hold.")
      // Automatically triggers camera restart
    } catch {
      toast.error("Failed to put order on hold.")
    }
  }, [holdOrderId, markHold])

  // Toggle checklist item packed state
  const handleToggleVerify = (itemId: string) => {
    if (!activeOrder) return
    const item = activeOrder.items.find(i => i.id === itemId)
    if (!item) return

    // Block manual click verification if strict scan mode is active
    const currentQty = verifiedQuantities[itemId] ?? 0
    if (verificationMode === 'strict_scan' && currentQty < item.quantity) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      toast.warning("Strict Scan Mode is enabled. Scan the product barcode/SKU to verify.", {
        position: 'top-center'
      })
      return
    }

    setVerifiedQuantities(prev => {
      const current = prev[itemId] ?? 0
      if (current >= item.quantity) {
        // Toggle back to 0 if clicked when fully verified
        return { ...prev, [itemId]: 0 }
      }
      const nextVal = current + 1
      const next = { ...prev, [itemId]: nextVal }

      // Auto-slide to next product after verification delay (400ms) if fully verified
      if (nextVal === item.quantity && currentProductIdx < activeOrder.items.length - 1) {
        setTimeout(() => {
          setCurrentProductIdx(prevIdx => prevIdx + 1)
        }, 400)
      }
      return next
    })
  }

  // Handle manual input search
  const handleManualSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualSearch.trim()) return
    onScanSuccess(manualSearch.trim())
  }

  // Log list filter sets
  const packedLogs = history.filter(h => h.status === 'Packed')
  const heldLogs = queue.filter(o => o.statusName === 'Packing Hold')

  // Verification helper variables
  const totalItemCount = activeOrder?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  const verifiedCount = activeOrder?.items.reduce((sum, item) => sum + (verifiedQuantities[item.id] ?? 0), 0) ?? 0
  const isAllVerified = activeOrder ? activeOrder.items.every(item => (verifiedQuantities[item.id] ?? 0) === item.quantity) : false

  // Hands-free USB barcode scanner input buffer
  useEffect(() => {
    if (selectedOrderId || activeTab !== 'scan') return

    let buffer = ''
    let lastKeyTime = Date.now()

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignore typing inside inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const currentTime = Date.now()
      // If more than 200ms elapsed since last keystroke, treat it as a new scan (resets buffer)
      if (currentTime - lastKeyTime > 200) {
        buffer = ''
      }
      lastKeyTime = currentTime

      if (e.key === 'Enter') {
        if (buffer.trim()) {
          onScanSuccess(buffer.trim())
          buffer = ''
        }
      } else if (e.key.length === 1) {
        buffer += e.key
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [selectedOrderId, activeTab, onScanSuccess])

  // Active Order Keyboard Inputs (Hotkeys & Product Scanner)
  useEffect(() => {
    if (!selectedOrderId || !activeOrder) return

    let buffer = ''
    let lastKeyTime = Date.now()

    const handleActiveOrderKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const currentTime = Date.now()
      if (currentTime - lastKeyTime > 200) {
        buffer = ''
      }
      lastKeyTime = currentTime

      if (e.key === 'Escape') {
        e.preventDefault()
        handleBackAndRelease()
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrentProductIdx(p => Math.max(0, p - 1))
        return
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCurrentProductIdx(p => Math.min(activeOrder.items.length - 1, p + 1))
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        const activeItem = activeOrder.items[currentProductIdx]
        if (activeItem) {
          handleToggleVerify(activeItem.id)
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (buffer.trim()) {
          const scannedCode = buffer.trim()
          buffer = ''

          const matchIdx = activeOrder.items.findIndex(
            item => item.sku && item.sku.toLowerCase() === scannedCode.toLowerCase()
          )

          if (matchIdx !== -1) {
            const matchedItem = activeOrder.items[matchIdx]
            const currentVerified = verifiedQuantities[matchedItem.id] ?? 0

            if (currentVerified >= matchedItem.quantity) {
              if (navigator.vibrate) navigator.vibrate([50, 50])
              toast.info(`Product "${matchedItem.productName}" is already fully verified.`)
            } else {
              setVerifiedQuantities(prev => {
                const nextVal = (prev[matchedItem.id] ?? 0) + 1
                const next = { ...prev, [matchedItem.id]: nextVal }

                if (navigator.vibrate) navigator.vibrate(100)

                // Auto-advance slide if this scan fully verifies the item
                if (nextVal === matchedItem.quantity && matchIdx < activeOrder.items.length - 1) {
                  setTimeout(() => {
                    setCurrentProductIdx(prevIdx => prevIdx + 1)
                  }, 450)
                }

                return next
              })

              // Focus slide on matching item
              if (currentProductIdx !== matchIdx) {
                setCurrentProductIdx(matchIdx)
              }
            }
          } else {
            // Wrong SKU alert
            if (navigator.vibrate) navigator.vibrate([150, 100, 150])
            toast.error(`Wrong Product! SKU "${scannedCode}" does not belong to this order!`, {
              position: 'top-center',
              duration: 4000
            })
          }
        } else if (isAllVerified) {
          handleDone(activeOrder.id)
        }
        return
      }

      // Buffer characters
      if (e.key.length === 1) {
        buffer += e.key
      }
    }

    window.addEventListener('keydown', handleActiveOrderKeyDown)
    return () => window.removeEventListener('keydown', handleActiveOrderKeyDown)
  }, [selectedOrderId, activeOrder, verifiedQuantities, currentProductIdx, isAllVerified, handleBackAndRelease, handleDone])

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 font-sans select-none">
      
      {/* 1. Header Navigation Panel */}
      <header className="h-14 shrink-0 px-3 border-b border-zinc-850 bg-zinc-900 flex items-center justify-between select-none">
        {/* Left: Brand/Logo */}
        <div className="flex flex-col text-start justify-center min-w-0">
          <h1 className="text-xs sm:text-sm font-black text-white tracking-tight flex items-center gap-1 sm:gap-1.5 truncate">
            <Package className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="truncate">EcoMate Pack</span>
          </h1>
          <span className="text-[9px] text-zinc-500 truncate max-w-[90px] sm:max-w-[180px]">
            {currentUser?.email}
          </span>
        </div>

        {/* Right: Actions and Mode Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Verification Mode Selector */}
          <div className="flex items-center gap-1 border border-zinc-800 bg-zinc-950 rounded-lg px-1.5 py-1 text-[10px] md:text-xs">
            <Scan className="h-3 w-3 text-zinc-400 shrink-0" />
            <select
              value={verificationMode}
              onChange={(e) => handleSetVerificationMode(e.target.value as any)}
              className="bg-transparent font-extrabold text-zinc-300 outline-none cursor-pointer focus:text-white border-none p-0 pr-0.5 text-[10px] md:text-xs"
            >
              <option value="strict_scan" className="bg-zinc-950 text-zinc-200">Strict</option>
              <option value="manual_allowed" className="bg-zinc-950 text-zinc-200">Manual</option>
            </select>
          </div>

          {/* Exit for supervisors */}
          {currentPackerRole !== 'packing_assistant' && (
            <button
              onClick={() => navigate({ to: '/op/overview' })}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] md:text-xs font-semibold rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-zinc-300 hover:text-white transition-all cursor-pointer shrink-0"
            >
              <LogOut className="h-3 w-3" />
              <span>Exit</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. Main Content Viewport */}
      <main className="flex-1 overflow-y-auto flex flex-col relative bg-zinc-950">
        
        {/* TAB A: Live QR/Barcode Camera Scanner */}
        {activeTab === 'scan' && (
          <div className={selectedOrderId ? "relative z-50 pointer-events-none" : "flex-1 flex flex-col p-4 space-y-4 max-w-lg mx-auto w-full"}>
            {/* Live Camera Frame box */}
            <div className={selectedOrderId
              ? "fixed bottom-24 right-4 z-50 w-28 h-28 md:w-36 md:h-36 rounded-full border-2 border-emerald-500 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col items-center justify-center transition-all duration-300 transform scale-100 hover:scale-105 active:scale-95 pointer-events-auto"
              : "relative w-full aspect-square rounded-3xl border-2 border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col items-center justify-center shadow-2xl"
            }>
              {scannerActive && !scannerError ? (
                <div id="scanner-viewport" className="h-full w-full object-cover"></div>
              ) : (
                <div className="p-4 text-center space-y-1 text-zinc-550 select-none">
                  <Camera className={`${selectedOrderId ? 'h-5 w-5' : 'h-10 w-10'} mx-auto text-zinc-650`} />
                  {!selectedOrderId && (
                    <>
                      <p className="text-zinc-400 text-sm font-semibold">Camera is paused</p>
                      <p className="text-zinc-600 text-xs">Tap start below to enable scanning</p>
                    </>
                  )}
                </div>
              )}

              {/* Animated scanning laser line overlay */}
              {scannerActive && !selectedOrderId && (
                <div className="absolute inset-x-0 top-0 h-1 bg-red-500 opacity-60 shadow-lg shadow-red-500 animate-scan-laser pointer-events-none"></div>
              )}

              {/* Picture-in-picture scan indicator laser */}
              {scannerActive && selectedOrderId && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500 shadow-[0_0_8px_#10b981] animate-scan-laser pointer-events-none z-10"></div>
              )}

              {/* Scanner Frame Guide Overlay */}
              {scannerActive && !selectedOrderId && (
                <div className="absolute inset-0 border-[24px] border-black/35 flex items-center justify-center pointer-events-none">
                  <div className="h-48 w-48 border border-blue-500/50 rounded-2xl relative shadow-md">
                    <div className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-blue-500"></div>
                    <div className="absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-blue-500"></div>
                    <div className="absolute -left-1 -bottom-1 h-4 w-4 border-l-2 border-b-2 border-blue-500"></div>
                    <div className="absolute -right-1 -bottom-1 h-4 w-4 border-r-2 border-b-2 border-blue-500"></div>
                  </div>
                </div>
              )}
            </div>

            {!selectedOrderId && (
              <>
                {/* Error logs */}
                {scannerError && (
                  <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-400 font-semibold text-center select-text">
                    {scannerError}
                  </div>
                )}

                {/* Camera Control Actions */}
                <div className="flex gap-2">
                  {/* Start/Stop toggle button */}
                  <button
                    onClick={() => setScannerActive(!scannerActive)}
                    className={`flex-1 py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all border ${
                      scannerActive 
                        ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-850' 
                        : 'bg-blue-600 border-blue-500 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {scannerActive ? (
                      <>
                        <Pause className="h-4 w-4 text-amber-500" />
                        Pause Scanner
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 text-green-500" />
                        Start Camera
                      </>
                    )}
                  </button>

                  {/* Camera Source Selector */}
                  {cameras.length > 1 && (
                    <div className="flex-1 relative">
                      <select
                        value={selectedCameraId}
                        onChange={(e) => setSelectedCameraId(e.target.value)}
                        className="w-full py-3.5 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-semibold text-zinc-200 outline-none cursor-pointer focus:border-zinc-700 select-none appearance-none"
                      >
                        {cameras.map((c, i) => (
                          <option key={c.id} value={c.id}>
                            Camera {i + 1} ({c.label.substring(0, 15) || 'Source'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Quick manual keyboard entry option */}
                <div className="pt-2 border-t border-zinc-900">
                  <button
                    onClick={() => setShowManualSearch(!showManualSearch)}
                    className="w-full text-center text-xs font-semibold text-zinc-500 hover:text-zinc-300 flex items-center justify-center gap-1 py-2 cursor-pointer"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {showManualSearch ? 'Hide Keyboard Input' : 'Type Order ID Manually'}
                  </button>

                  {showManualSearch && (
                    <form onSubmit={handleManualSearchSubmit} className="mt-2 flex gap-2">
                      <Input
                        type="text"
                        placeholder="Type display ID, guest, etc."
                        className="flex-1 bg-zinc-900 border-zinc-800 text-zinc-100 text-xs py-5 rounded-xl font-medium focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:border-blue-500 placeholder-zinc-500 select-text"
                        value={manualSearch}
                        onChange={(e) => setManualSearch(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-bold text-white hover:bg-zinc-850 cursor-pointer"
                      >
                        Load
                      </button>
                    </form>
                  )}
                </div>

                {/* Personal Packer Dashboard Statistics */}
                <div className="border border-zinc-900 bg-zinc-900/10 rounded-2xl p-4 mt-4">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-550 block text-center mb-3">
                    Desk Packing stats today
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col p-2.5 rounded-xl bg-green-950/10 border border-green-900/25 text-center">
                      <span className="text-green-400 text-lg font-black">{stats?.packed ?? 0}</span>
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Packed</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl bg-amber-950/10 border border-amber-900/25 text-center">
                      <span className="text-amber-400 text-lg font-black">{stats?.held ?? 0}</span>
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Held</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl bg-blue-950/10 border border-blue-900/25 text-center">
                      <span className="text-blue-400 text-lg font-black">{stats?.pending ?? 0}</span>
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Queue</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB B: Packed Order Logs (History) */}
        {activeTab === 'packed' && (
          <div className="flex-1 flex flex-col p-4 max-w-lg mx-auto w-full space-y-3">
            <h2 className="text-base font-bold text-white mb-1">Packed Orders Today</h2>
            {isHistoryLoading ? (
              <div className="text-center py-10 text-zinc-500 text-sm">Loading packed logs...</div>
            ) : packedLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-850 rounded-2xl p-6 text-zinc-500 space-y-2">
                <CheckCircle2 className="h-8 w-8 text-zinc-650 mx-auto" />
                <p className="font-semibold text-sm">No packed logs found today</p>
                <p className="text-xs text-zinc-600">Scan and complete packing to see them here.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {packedLogs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => setViewedPackedOrder(log)}
                    className="p-3.5 bg-zinc-900 border border-zinc-850 hover:border-zinc-750 rounded-2xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex flex-col text-start">
                      <span className="font-mono text-sm font-bold text-white">{log.displayId}</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">
                        {new Date(log.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400 uppercase tracking-wider">
                        Packed
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-zinc-650" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB C: Held Order Logs (Packing Holds) */}
        {activeTab === 'held' && (
          <div className="flex-1 flex flex-col p-4 max-w-lg mx-auto w-full space-y-3">
            <h2 className="text-base font-bold text-white mb-1">Currently Held Orders</h2>
            {isQueueLoading ? (
              <div className="text-center py-10 text-zinc-500 text-sm">Loading hold list...</div>
            ) : heldLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-850 rounded-2xl p-6 text-zinc-500 space-y-2">
                <AlertTriangle className="h-8 w-8 text-zinc-650 mx-auto" />
                <p className="font-semibold text-sm">No orders currently on hold</p>
                <p className="text-xs text-zinc-600">Held orders will show up here for easy resumption.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {heldLogs.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => setViewedHeldOrder(order)}
                    className="p-3.5 bg-zinc-900 border border-zinc-850 hover:border-zinc-755 rounded-2xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex flex-col text-start">
                      <span className="font-mono text-sm font-bold text-white">{order.displayId}</span>
                      <span className="text-[10px] text-amber-500/80 font-medium mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        On hold ({order.totalItems} items)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-wider">
                        Held
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-zinc-650" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. visual Details Active Order Overlay (Carousel layout) */}
        {selectedOrderId && activeOrder && (
          <div className="absolute inset-0 z-40 bg-zinc-950 flex flex-col h-full overflow-hidden">
            {/* Overlay Header */}
            <div className="h-14 shrink-0 px-4 border-b border-zinc-850 bg-zinc-900/60 flex items-center justify-between">
              <button
                onClick={handleBackAndRelease}
                className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-450 hover:text-white transition-colors cursor-pointer border border-zinc-800 flex items-center justify-center shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="text-xs font-semibold pr-1">Back</span>
              </button>

              <div className="flex flex-col text-center">
                <span className="font-mono text-base font-extrabold text-white">
                  Order {activeOrder.displayId}
                </span>
                <span className="text-[9px] font-bold text-zinc-500">
                  {activeOrder.statusName} status
                </span>
              </div>

              {/* Progress counter */}
              <div className="flex items-center gap-1 select-none">
                <span className="text-[10px] px-2.5 py-1 rounded-full text-xs font-black bg-zinc-900 border border-zinc-800 text-zinc-350">
                  {verifiedCount}/{totalItemCount} packed
                </span>
              </div>
            </div>

            {/* Carousel Item Viewport */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col justify-between space-y-4">
              
              {/* Locked Warning */}
              {activeOrder.packingLock && activeOrder.packingLock.packerId !== currentPackerId && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-2 select-none">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  Locked by {activeOrder.packingLock.packerName}. Actions disabled.
                </div>
              )}

              {/* Active Product Swiper Card */}
              {activeOrder.items[currentProductIdx] ? (
                (() => {
                  const item = activeOrder.items[currentProductIdx]
                  const currentVerifiedQty = verifiedQuantities[item.id] ?? 0
                  const isVerified = currentVerifiedQty === item.quantity
                  const isMultiple = item.quantity > 1

                  return (
                    <div className="flex-1 flex flex-col justify-between space-y-4">
                      {/* Product Image Box */}
                      <div className="relative w-full h-56 md:h-72 shrink-0 rounded-2xl bg-zinc-900 border border-zinc-850 flex items-center justify-center overflow-hidden shadow-inner">
                        <SafeImage
                          src={item.image}
                          alt=""
                          className="h-full w-full object-contain cursor-zoom-in active:scale-95 transition-transform"
                          onClick={() => item.image && setZoomImage(item.image)}
                        />

                        {/* Zoom magnifier indicator icon */}
                        {item.image && (
                          <button 
                            onClick={() => item.image && setZoomImage(item.image)}
                            className="absolute right-3.5 bottom-3.5 p-2 rounded-xl bg-black/60 text-zinc-300 border border-zinc-800 hover:text-white transition-colors cursor-pointer"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Product details text container */}
                      <div className="space-y-2 flex-1 flex flex-col justify-center">
                        <h3 className="text-base md:text-lg font-black text-white leading-tight">
                          {item.productName}
                        </h3>

                        <div className="flex flex-wrap gap-1.5 justify-center items-center">
                          {item.variantName && (
                            <span className="text-xs font-bold text-zinc-300 bg-zinc-850 border border-zinc-850 px-2.5 py-0.5 rounded-lg">
                              {item.variantName}
                            </span>
                          )}
                          {item.sku && (
                            <span className="font-mono text-[10px] text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-900 select-text selection:bg-blue-600">
                              SKU: {item.sku}
                            </span>
                          )}
                        </div>

                        {/* Multiple Quantity warning blinks */}
                        {isMultiple && !isVerified && (
                          <div className="py-2.5 px-4 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 font-extrabold text-xs flex items-center justify-center gap-1.5 animate-pulse select-none">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                            PACK {item.quantity} ITEMS! MULTIPLE QUANTITY DETECTED.
                          </div>
                        )}

                        {/* Strict Scan Guide banner */}
                        {!isVerified && (
                          <div className="py-2.5 px-4 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-1.5 animate-pulse select-none">
                            <Scan className="h-4.5 w-4.5 shrink-0 text-emerald-400" />
                            {verificationMode === 'strict_scan' 
                              ? "SCAN PRODUCT SKU BARCODE TO PACK" 
                              : "SCAN BARCODE OR TAP BUTTON TO PACK"
                            }
                          </div>
                        )}
                      </div>

                      {/* Giant Qty Status Widget */}
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-850">
                        <span className="text-xs font-black text-zinc-450 uppercase tracking-wider select-none">
                          Items to Pack
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-2xl font-black px-4 py-1.5 rounded-xl border select-none ${
                            isVerified
                              ? 'bg-green-600/10 border-green-500 text-green-400'
                              : isMultiple
                                ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                                : 'bg-blue-500/10 border-blue-500 text-blue-500'
                          }`}>
                            {currentVerifiedQty} / {item.quantity}
                          </span>
                        </div>
                      </div>

                      {/* Verification click off button */}
                      <div className="pt-2">
                        <button
                          onClick={() => handleToggleVerify(item.id)}
                          className={`w-full py-4 rounded-2xl text-sm md:text-base font-extrabold shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                            isVerified
                              ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                              : verificationMode === 'strict_scan'
                                ? 'bg-zinc-950 border border-zinc-900 text-zinc-550 cursor-not-allowed opacity-70'
                                : 'bg-zinc-900 border border-zinc-800 text-zinc-250 hover:bg-zinc-850 cursor-pointer'
                          }`}
                        >
                          {isVerified ? (
                            <>
                              <Check className="h-4 w-4 stroke-[3]" />
                              Verified & Packed
                            </>
                          ) : verificationMode === 'strict_scan' ? (
                            <>
                              <Scan className="h-4 w-4 text-zinc-500 animate-pulse" />
                              Scan Barcode to Verify ({currentVerifiedQty}/{item.quantity})
                            </>
                          ) : (
                            <>
                              <Check className="h-4 w-4 stroke-[3] text-zinc-500 animate-pulse" />
                              Verify 1 Piece ({currentVerifiedQty}/{item.quantity})
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })()
              ) : (
                <div className="text-zinc-550 text-sm">No items in this order.</div>
              )}

              {/* Slider Navigation arrows */}
              {activeOrder.items.length > 1 && (
                <div className="flex items-center justify-between select-none shrink-0 py-1 bg-zinc-900/10 rounded-xl px-2">
                  <button
                    disabled={currentProductIdx === 0}
                    onClick={() => setCurrentProductIdx(prev => prev - 1)}
                    className="p-2 border border-zinc-800 rounded-xl hover:bg-zinc-850 text-zinc-300 disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-semibold text-zinc-400">
                    Product {currentProductIdx + 1} of {activeOrder.items.length} ({totalItemCount} total items)
                  </span>
                  <button
                    disabled={currentProductIdx === activeOrder.items.length - 1}
                    onClick={() => setCurrentProductIdx(prev => prev + 1)}
                    className="p-2 border border-zinc-800 rounded-xl hover:bg-zinc-850 text-zinc-300 disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Toggle Customer Info Panel */}
              <div className="border border-zinc-850 rounded-2xl overflow-hidden bg-zinc-900/20 shrink-0">
                <button
                  onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                  className="w-full px-4 py-3 flex items-center justify-between text-zinc-450 hover:text-white transition-all text-[11px] font-extrabold uppercase tracking-wider cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-zinc-500" />
                    Customer & courier metadata
                  </span>
                  <span className="text-xs font-semibold text-blue-500">
                    {showCustomerDetails ? 'Hide' : 'View'}
                  </span>
                </button>

                {showCustomerDetails && (
                  <div className="px-5 py-4 border-t border-zinc-850 text-start text-xs space-y-2 bg-zinc-900/10 text-zinc-300 select-text">
                    <p><span className="text-zinc-500 font-bold select-none">Name:</span> {activeOrder.customer?.name ?? 'Guest User'}</p>
                    <p><span className="text-zinc-500 font-bold select-none">Phone:</span> {activeOrder.customer?.phone ?? 'N/A'}</p>
                    <p><span className="text-zinc-500 font-bold select-none">Created Date:</span> {new Date(activeOrder.createdAt).toLocaleString()}</p>
                    <p><span className="text-zinc-500 font-bold select-none">Order Status:</span> {activeOrder.statusName}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Giant Sticky actions drawer footer */}
            <div className="shrink-0 p-4 border-t border-zinc-850 bg-zinc-900/60 flex items-center justify-between gap-3 select-none">
              <div className="flex gap-2">
                {/* Print */}
                <button
                  onClick={() => window.open(`/op/print/sticker/${activeOrder.id}`, '_blank')}
                  className="p-4 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-350 hover:text-white cursor-pointer"
                  title="Print sticker label"
                >
                  <Printer className="h-4 w-4" />
                </button>
                {/* Hold */}
                <button
                  onClick={() => handleHold(activeOrder.id)}
                  className="p-4 rounded-xl border border-zinc-800 bg-zinc-950 text-amber-500/80 hover:text-amber-400 cursor-pointer"
                  title="Put order on hold"
                >
                  <AlertTriangle className="h-4 w-4" />
                </button>
              </div>

              {/* Giant packed done button */}
              <button
                disabled={activeOrder.packingLock ? activeOrder.packingLock.packerId !== currentPackerId : false}
                onClick={() => handleDone(activeOrder.id)}
                className={`flex-1 py-4.5 rounded-2xl text-sm font-extrabold text-white transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] ${
                  isAllVerified
                    ? 'bg-green-600 hover:bg-green-700 animate-pulse-subtle'
                    : 'bg-zinc-800 hover:bg-zinc-750 text-zinc-400 border border-zinc-700/50'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Complete Pack (Done)
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 4. Bottom Tab Bar Navigation panel */}
      {!selectedOrderId && (
        <nav className="h-16 shrink-0 border-t border-zinc-850 bg-zinc-900 flex items-center justify-around select-none">
          {/* Tab 1: Scanner */}
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'scan' ? 'text-blue-500 font-bold' : 'text-zinc-500 hover:text-zinc-350'
            }`}
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px]">Scan & Pack</span>
          </button>

          {/* Tab 2: Packed Logs */}
          <button
            onClick={() => setActiveTab('packed')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'packed' ? 'text-blue-500 font-bold' : 'text-zinc-500 hover:text-zinc-350'
            }`}
          >
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-[10px]">Packed ({packedLogs.length})</span>
          </button>

          {/* Tab 3: Held Logs */}
          <button
            onClick={() => setActiveTab('held')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'held' ? 'text-blue-500 font-bold' : 'text-zinc-500 hover:text-zinc-350'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
            <span className="text-[10px]">Held ({heldLogs.length})</span>
          </button>
        </nav>
      )}

      {/* 5. MODAL: Packed Log details viewer */}
      {viewedPackedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-text" onClick={() => setViewedPackedOrder(null)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2.5">
              <span className="font-mono font-bold text-white">Packed Details {viewedPackedOrder.displayId}</span>
              <button onClick={() => setViewedPackedOrder(null)} className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 select-none cursor-pointer">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-zinc-300 text-start">
              <p><span className="text-zinc-500 font-bold select-none">Order status:</span> <span className="text-green-400 font-semibold uppercase">Packed</span></p>
              <p><span className="text-zinc-500 font-bold select-none">Packed Timestamp:</span> {new Date(viewedPackedOrder.updatedAt).toLocaleString()}</p>
              <p><span className="text-zinc-500 font-bold select-none">Packer user:</span> {viewedPackedOrder.packerName}</p>
            </div>
            <div className="border-t border-zinc-800 pt-2 text-start select-none">
              <button 
                onClick={() => setViewedPackedOrder(null)}
                className="w-full py-2.5 bg-zinc-800 rounded-xl text-xs font-semibold hover:bg-zinc-750 text-white cursor-pointer"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL: Held Log details viewer with Resume */}
      {viewedHeldOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-text" onClick={() => setViewedHeldOrder(null)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2.5">
              <span className="font-mono font-bold text-white">Held Details {viewedHeldOrder.displayId}</span>
              <button onClick={() => setViewedHeldOrder(null)} className="p-1 rounded-full hover:bg-zinc-800 text-zinc-450 select-none cursor-pointer">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-zinc-300 text-start">
              <p><span className="text-zinc-500 font-bold select-none">Order Status:</span> <span className="text-amber-400 font-semibold uppercase">Packing Hold</span></p>
              <p><span className="text-zinc-500 font-bold select-none">Total Items:</span> {viewedHeldOrder.totalItems}</p>
              <p><span className="text-zinc-500 font-bold select-none">Hold Timestamp:</span> {new Date(viewedHeldOrder.createdAt).toLocaleString()}</p>
              {viewedHeldOrder.customer && (
                <>
                  <p><span className="text-zinc-500 font-bold select-none">Customer Name:</span> {viewedHeldOrder.customer.name}</p>
                  <p><span className="text-zinc-500 font-bold select-none">Phone:</span> {viewedHeldOrder.customer.phone}</p>
                </>
              )}
            </div>
            <div className="flex gap-2.5 border-t border-zinc-800 pt-3 select-none">
              <button 
                onClick={() => setViewedHeldOrder(null)}
                className="flex-1 py-2.5 bg-zinc-800 border border-zinc-750 rounded-xl text-xs font-semibold hover:bg-zinc-750 text-zinc-300 cursor-pointer"
              >
                Close
              </button>
              <button 
                onClick={() => {
                  const ordId = viewedHeldOrder.id
                  setViewedHeldOrder(null)
                  // Find in queue
                  const qItem = queue.find(q => q.id === ordId)
                  if (qItem) openAndSelect(qItem)
                }}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-xs font-extrabold text-white cursor-pointer"
              >
                Resume Packing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Full-screen Image zoom overlay */}
      {zoomImage && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4 select-none" onClick={() => setZoomImage(null)}>
          <button 
            onClick={() => setZoomImage(null)}
            className="absolute right-4 top-4 p-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="h-6 w-6" />
          </button>
          <SafeImage src={zoomImage} alt="" className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl" />
        </div>
      )}

      {/* Hold Modal overlays */}
      {holdOrderId && (
        <HoldModal
          orderId={holdOrderId}
          onClose={() => setHoldOrderId(null)}
          onSubmit={handleHoldSubmit}
          isSubmitting={markHold.isPending}
        />
      )}
      {/* 8. Local Animation CSS Styles */}
      <style>{`
        @keyframes scan-laser {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
        .animate-scan-laser {
          animation: scan-laser 2.5s infinite linear;
        }
        @keyframes pulse-subtle {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.95; transform: scale(0.99); }
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 2s infinite ease-in-out;
        }
        #scanner-viewport video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border-radius: 20px !important;
        }
      `}</style>
    </div>
  )
}
