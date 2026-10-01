import { useEffect, useCallback, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { usePackingQueuePage, usePackingStats, useOpenOrder, useMarkDone, useMarkHold, usePackingHistory, useReleaseLock, useCheckOrderStatus } from './hooks'
import { HoldModal } from './HoldModal'
import { Input } from '@/components/ui/input'
import { Html5Qrcode, type CameraDevice } from 'html5-qrcode'
import {
  createScanner,
  pickDefaultCamera,
  type ScannerController,
} from './scanner-controller'
import { SafeImage } from '@/components/safe-image'
import { mediaUrl } from '@/lib/utils'
import {
  resolveOrderItemImages,
  type ProductImageSource,
  type ProductVariantImageSource,
} from '@/lib/product-image'
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
import type { QueueItem, HoldFormData, HistoryEntry } from './types'

type TabType = 'scan' | 'packed' | 'held'

// Stable empty array so `queue` keeps a constant identity between polls.
const EMPTY_QUEUE: QueueItem[] = []

// Must match the id of the scanner viewport element in the JSX.
const SCANNER_ELEMENT_ID = 'scanner-viewport'

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
  const [zoomImage, setZoomImage] = useState<{ src: string; fallbackSrc?: string | null } | null>(null)
  const [manualSearch, setManualSearch] = useState('')
  const [showManualSearch, setShowManualSearch] = useState(false)

  const [verificationMode, setVerificationMode] = useState<'strict_scan' | 'manual_allowed'>('strict_scan')

  const handleSetVerificationMode = useCallback((mode: 'strict_scan' | 'manual_allowed') => {
    setVerificationMode(mode)
    toast.success(`Verification mode set to: ${mode === 'strict_scan' ? 'Strict Scan' : 'Manual'}`)
  }, [])

  // Modal logs viewer states (properly typed — HistoryEntry / QueueItem both
  // exist in ./types, these were `any`.)
  const [viewedPackedOrder, setViewedPackedOrder] = useState<HistoryEntry | null>(null)
  const [viewedHeldOrder, setViewedHeldOrder] = useState<QueueItem | null>(null)

  // Camera scanner states
  const [scannerActive, setScannerActive] = useState(true)
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [scannerError, setScannerError] = useState<string | null>(null)
  const controllerRef = useRef<ScannerController | null>(null)

  // The queue is polled every 15s. Mirroring it into a ref keeps
  // `onScanSuccess` (and therefore the camera effect that depends on it) from
  // getting a new identity on every poll — which used to tear the scanner down
  // and restart the camera 4x per minute on the packing line.
  const queueRef = useRef<QueueItem[]>([])

  // Checklist persistence. `verifiedRef` is the source of truth for the current
  // order's per-item progress; `checklistOwnerRef` is the order that progress
  // belongs to. Load and save are deliberately NOT a pair of racing effects:
  // a single `commitChecklist` writes synchronously against the owning order,
  // so switching orders can never write the previous order's checklist under
  // the new order's key.
  const verifiedRef = useRef<Record<string, number>>({})
  const checklistOwnerRef = useRef<string | null>(null)
  const submittingRef = useRef(false)
  const lastScanRef = useRef<{ code: string; at: number } | null>(null)
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checklistKey = useCallback(
    (orderId: string) => `packing_checklist_v2_${orderId}`,
    [],
  )

  const commitChecklist = useCallback(
    (next: Record<string, number>) => {
      verifiedRef.current = next
      setVerifiedQuantities(next)
      const owner = checklistOwnerRef.current
      if (!owner) return
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(checklistKey(owner))
      } else {
        localStorage.setItem(checklistKey(owner), JSON.stringify(next))
      }
    },
    [checklistKey],
  )

  const clearChecklist = useCallback(
    (orderId: string) => {
      if (checklistOwnerRef.current === orderId) {
        verifiedRef.current = {}
        checklistOwnerRef.current = null
        setVerifiedQuantities({})
      }
      localStorage.removeItem(checklistKey(orderId))
    },
    [checklistKey],
  )

  // Load verifiedQuantities from localStorage when the selected order changes
  useEffect(() => {
    if (!selectedOrderId) {
      verifiedRef.current = {}
      checklistOwnerRef.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVerifiedQuantities({})
      return
    }
    let loaded: Record<string, number> = {}
    const saved = localStorage.getItem(checklistKey(selectedOrderId))
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') loaded = parsed
      } catch (err) {
        console.error('Failed to parse saved checklist items', err)
      }
    }
    // Claim ownership BEFORE committing so any later mutation persists against
    // the correct order.
    checklistOwnerRef.current = selectedOrderId
    verifiedRef.current = loaded
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerifiedQuantities(loaded)
  }, [selectedOrderId, checklistKey])

  // Queries & Mutations
  const {
    data: queuePage,
    isLoading: isQueueLoading,
    isSuccess: isQueueLoaded,
  } = usePackingQueuePage()
  const queue = queuePage?.orders ?? EMPTY_QUEUE
  const photoCatalog = queuePage?.photoCatalog
  const { data: stats } = usePackingStats()
  const { data: history = [], isLoading: isHistoryLoading } = usePackingHistory(currentPackerId)

  const openOrder = useOpenOrder()
  const markDone = useMarkDone()
  const markHold = useMarkHold()
  const releaseLock = useReleaseLock()
  const checkStatus = useCheckOrderStatus()

  const activeOrder = queue.find((o) => o.id === selectedOrderId)
  queueRef.current = queue

  // Open and lock order
  const openAndSelect = useCallback(async (order: QueueItem) => {
    if (!order) return
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
    const orderId = selectedOrderId
    if (orderId) {
      try {
        await releaseLock.mutateAsync(orderId)
      } catch (err) {
        console.error("Failed to release lock on exit", err)
      }
      // Only drop the checklist once the lock release has actually settled —
      // otherwise a failed exit would silently destroy the packer's progress.
      clearChecklist(orderId)
      setSelectedOrderId(null)
      setManualSearch('')
    }
  }, [selectedOrderId, releaseLock, clearChecklist])

  // P0-1 recovery: if the selected order is no longer in the (polled) queue it
  // was packed, held or un-confirmed by someone else. Without this the overlay,
  // the back button, the camera and every hotkey all unregister at once, so the
  // packer is left holding a 30-minute server-side lock with no way out.
  useEffect(() => {
    if (!selectedOrderId || activeOrder) return
    // Wait until the first successful load so an initial empty/error response
    // doesn't tear down a valid selection.
    if (!isQueueLoaded) return
    const orderId = selectedOrderId
    toast.warning("This order left the packing queue. Lock released.")
    setSelectedOrderId(null)
    setManualSearch('')
    releaseLock.mutateAsync(orderId).catch((err) => {
      console.error("Failed to release lock for dropped order", err)
    })
  }, [selectedOrderId, activeOrder, isQueueLoaded, releaseLock])

  // Scan success trigger. Reads the queue from a ref (not from state) so its
  // identity stays stable across the 15s poll and the camera never restarts.
  const onScanSuccess = useCallback(async (decodedText: string) => {
    // P2-5: html5-qrcode fires continuously while a code is in frame. Collapse
    // repeats of the same code within a short window so one scan = one request.
    const code = decodedText.trim()
    const now = Date.now()
    const last = lastScanRef.current
    if (last && last.code === code && now - last.at < 2000) return
    lastScanRef.current = { code, at: now }

    // Search in the active queue (contains both Confirmed & Packing Hold statuses!)
    const matched = queueRef.current.find((o) =>
      o.id.toLowerCase() === code.toLowerCase() ||
      o.displayId.toLowerCase() === code.toLowerCase()
    )

    if (matched) {
      if (navigator.vibrate) navigator.vibrate(100)
      openAndSelect(matched)
    } else {
      try {
        const res = await checkStatus.mutateAsync(code)
        if (res.exists) {
          const orderStatus = res.status || ''
          const orderDisplayId = res.displayId || code

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
          toast.error(`Order "${code}" was not found in the system.`, {
            position: 'top-center'
          })
        }
      } catch (err) {
        console.error("Failed to check order status", err)
        if (navigator.vibrate) navigator.vibrate([50, 50, 50])
        toast.error(`Order "${code}" was not found in the system.`, {
          position: 'top-center'
        })
      }
    }
  }, [openAndSelect, checkStatus])

  // Get cameras list on mount
  useEffect(() => {
    Html5Qrcode.getCameras()
      .then(devices => {
        if (devices && devices.length > 0) {
          setCameras(devices)
          setSelectedCameraId(pickDefaultCamera(devices))
        } else {
          setScannerError("No cameras detected on this device.")
        }
      })
      .catch(err => {
        console.error("Camera detection error", err)
        setScannerError("Camera permission denied or unavailable.")
      })
  }, [])

  // Camera start/stop controller. All lifecycle work goes through
  // `createScanner`, which serialises start/stop against html5-qrcode's
  // single-slot transition lock. Gating cleanup on the library's own
  // `isScanning` flag let `stop()` be called while `start()` still held that
  // lock, which throws synchronously ("Cannot transition to a new state, already
  // under transition") and took down the page with a 500 while leaving the
  // camera stream open and the viewport permanently white.
  useEffect(() => {
    const shouldRun =
      activeTab === 'scan' && !selectedOrderId && scannerActive && !!selectedCameraId
    if (!shouldRun || !selectedCameraId) {
      void controllerRef.current?.dispose()
      return
    }

    const controller = createScanner(
      SCANNER_ELEMENT_ID,
      {
        fps: 15,
        qrbox: (width: number, height: number) => {
          const size = Math.min(width, height) * 0.75
          return { width: size, height: size }
        },
      },
      {
        onScan: (decodedText) => onScanSuccess(decodedText),
        onError: (err) => {
          console.error('Camera scanner error', err)
          setScannerError('Camera is currently in use or not responding.')
        },
      },
    )
    controllerRef.current = controller
    void controller.start(selectedCameraId)

    return () => {
      void controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [activeTab, selectedOrderId, scannerActive, selectedCameraId, onScanSuccess])

  const handleDone = useCallback(async (orderId: string) => {
    // P0-3: a hardware scanner sends a trailing Enter, so double-submit is the
    // norm rather than the exception. Without this guard the second call hits
    // "Order is not opened for packing" and reports a FAILURE for an order that
    // actually packed successfully.
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await markDone.mutateAsync({ orderId, verificationMode })
      // Only discard verification progress once the server has accepted it.
      clearChecklist(orderId)
      setSelectedOrderId(null)
      setManualSearch('')
      toast.success("Order packed successfully!")
    } catch (err: any) {
      const msg = err.response?.data?.message
      toast.error(msg || "Failed to complete packing.")
    } finally {
      submittingRef.current = false
    }
  }, [markDone, verificationMode, clearChecklist])

  const handleHold = useCallback((orderId: string) => {
    setHoldOrderId(orderId)
  }, [])

  const handleHoldSubmit = useCallback(async (data: HoldFormData) => {
    if (!holdOrderId) return
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await markHold.mutateAsync({ orderId: holdOrderId, data })
      clearChecklist(holdOrderId)
      setHoldOrderId(null)
      setSelectedOrderId(null)
      setManualSearch('')
      toast.success("Order placed on hold.")
    } catch (err: any) {
      const msg = err.response?.data?.message
      toast.error(msg || "Failed to put order on hold.")
    } finally {
      submittingRef.current = false
    }
  }, [holdOrderId, markHold, clearChecklist])

  // Auto-slide to the next product. The timer is tracked and cleared so a
  // pending slide can never fire against a different order (P2-2).
  const scheduleAutoAdvance = useCallback((delay = 400) => {
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current)
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null
      setCurrentProductIdx(prev => prev + 1)
    }, delay)
  }, [])

  // Toggle checklist item packed state
  const handleToggleVerify = (itemId: string) => {
    if (!activeOrder) return
    const item = activeOrder.items.find(i => i.id === itemId)
    if (!item) return

    // Block manual click verification if strict scan mode is active
    const currentQty = verifiedRef.current[itemId] ?? 0
    if (verificationMode === 'strict_scan' && currentQty < item.quantity) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      toast.warning("Strict Scan Mode is enabled. Scan the product barcode/SKU to verify.", {
        position: 'top-center'
      })
      return
    }

    const current = currentQty
    // Toggle back to 0 if clicked when fully verified, otherwise increment.
    const nextVal = current >= item.quantity ? 0 : current + 1
    // P2-3: computed outside the updater. Updaters must stay pure — the old
    // code called vibrate() and setTimeout() *inside* it, so StrictMode's
    // double-invoke fired both twice.
    commitChecklist({ ...verifiedRef.current, [itemId]: nextVal })

    if (nextVal === item.quantity && currentProductIdx < activeOrder.items.length - 1) {
      scheduleAutoAdvance()
    }
  }

  // Handle manual input search
  const handleManualSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualSearch.trim()) return
    onScanSuccess(manualSearch.trim())
  }

  const openZoom = useCallback((src: string, fallbackSrc?: string | null) => {
    setZoomImage({ src, fallbackSrc: fallbackSrc || null })
  }, [])

  // Log list filter sets. The backend returns `statusName` (not `status`) on
  // history entries — filtering on `h.status` matched nothing and left the
  // Packed tab permanently empty.
  const packedLogs = history.filter(h => h.statusName === 'Packed')
  const heldLogs = queue.filter(o => o.statusName === 'Packing Hold')

  // Verification helper variables (read from the ref, which is always in sync
  // with the persisted checklist even before a re-render lands)
  const totalItemCount = activeOrder?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  const verifiedCount = activeOrder?.items.reduce((sum, item) => sum + (verifiedRef.current[item.id] ?? 0), 0) ?? 0
  const isAllVerified = activeOrder ? activeOrder.items.every(item => (verifiedRef.current[item.id] ?? 0) === item.quantity) : false

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
            const currentVerified = verifiedRef.current[matchedItem.id] ?? 0

            if (currentVerified >= matchedItem.quantity) {
              if (navigator.vibrate) navigator.vibrate([50, 50])
              toast.info(`Product "${matchedItem.productName}" is already fully verified.`)
            } else {
              if (navigator.vibrate) navigator.vibrate(100)
              const nextVal = currentVerified + 1
              // P2-3: no side effects inside the state updater.
              commitChecklist({
                ...verifiedRef.current,
                [matchedItem.id]: nextVal,
              })

              // Auto-advance slide if this scan fully verifies the item
              if (nextVal === matchedItem.quantity && matchIdx < activeOrder.items.length - 1) {
                scheduleAutoAdvance(450)
              }

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
  }, [selectedOrderId, activeOrder, currentProductIdx, isAllVerified, handleBackAndRelease, handleDone, commitChecklist, scheduleAutoAdvance])

  // Cancel any pending carousel auto-advance when the order changes or the
  // workspace unmounts, so it can never slide a different order (P2-2).
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current)
        autoAdvanceTimerRef.current = null
      }
    }
  }, [selectedOrderId])

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--canvas)] text-[var(--ink)] font-sans select-none">
      
      {/* 1. Header Navigation Panel */}
      <header className="h-14 shrink-0 px-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between select-none">
        {/* Left: Brand/Logo */}
        <div className="flex flex-col text-start justify-center min-w-0">
          <h1 className="text-xs sm:text-sm font-black text-white tracking-tight flex items-center gap-1 sm:gap-1.5 truncate">
            <Package className="h-3.5 w-3.5 text-info shrink-0" />
            <span className="truncate">EcoMate Pack</span>
          </h1>
          <span className="text-[9px] text-[var(--ink-muted)] truncate max-w-[90px] sm:max-w-[180px]">
            {currentUser?.email}
          </span>
        </div>

        {/* Right: Actions and Mode Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Verification Mode Selector */}
          <div className="flex items-center gap-1 border border-[var(--border)] bg-[var(--canvas)] rounded-lg px-1.5 py-1 text-[10px] md:text-xs">
            <Scan className="h-3 w-3 text-[var(--ink-muted)] shrink-0" />
            <select
              value={verificationMode}
              onChange={(e) => handleSetVerificationMode(e.target.value as any)}
              className="bg-transparent font-extrabold text-[var(--ink-muted)] outline-none cursor-pointer focus:text-white border-none p-0 pr-0.5 text-[10px] md:text-xs"
            >
              <option value="strict_scan" className="bg-[var(--canvas)] text-zinc-200">Strict</option>
              <option value="manual_allowed" className="bg-[var(--canvas)] text-zinc-200">Manual</option>
            </select>
          </div>

          {/* Exit for supervisors */}
          {currentPackerRole !== 'packing_assistant' && (
            <button
              onClick={() => navigate({ to: '/op/overview' })}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] md:text-xs font-semibold rounded-lg border border-[var(--border)] hover:border-[var(--border)] bg-[var(--canvas)] text-[var(--ink-muted)] hover:text-white transition-all cursor-pointer shrink-0"
            >
              <LogOut className="h-3 w-3" />
              <span>Exit</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. Main Content Viewport */}
      <main className="flex-1 overflow-y-auto flex flex-col relative bg-[var(--canvas)]">
        
        {/* TAB A: Live QR/Barcode Camera Scanner */}
        {activeTab === 'scan' && (
          <div className={selectedOrderId ? "relative z-50 pointer-events-none" : "flex-1 flex flex-col p-4 space-y-4 max-w-lg mx-auto w-full"}>
            {/* Live Camera Frame box */}
            <div className={selectedOrderId
              ? "fixed bottom-24 right-4 z-50 w-28 h-28 md:w-36 md:h-36 rounded-full border-2 border-success bg-[var(--surface)] shadow-2xl overflow-hidden flex flex-col items-center justify-center transition-all duration-300 transform scale-100 hover:scale-105 active:scale-95 pointer-events-auto"
              : "relative w-full aspect-square rounded-3xl border-2 border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col items-center justify-center shadow-2xl"
            }>
              {scannerActive && !scannerError ? (
                <div id="scanner-viewport" className="h-full w-full object-cover"></div>
              ) : (
                <div className="p-4 text-center space-y-1 text-zinc-550 select-none">
                  <Camera className={`${selectedOrderId ? 'h-5 w-5' : 'h-10 w-10'} mx-auto text-[var(--ink-muted)]`} />
                  {!selectedOrderId && (
                    <>
                      <p className="text-[var(--ink-muted)] text-sm font-semibold">Camera is paused</p>
                      <p className="text-zinc-600 text-xs">Tap start below to enable scanning</p>
                    </>
                  )}
                </div>
              )}

              {/* Animated scanning laser line overlay */}
              {scannerActive && !selectedOrderId && (
                <div className="absolute inset-x-0 top-0 h-1 bg-danger opacity-60 shadow-lg shadow-danger animate-scan-laser pointer-events-none"></div>
              )}

              {/* Picture-in-picture scan indicator laser */}
              {scannerActive && selectedOrderId && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-success shadow-[0_0_8px_var(--success)] animate-scan-laser pointer-events-none z-10"></div>
              )}

              {/* Scanner Frame Guide Overlay */}
              {scannerActive && !selectedOrderId && (
                <div className="absolute inset-0 border-[24px] border-black/35 flex items-center justify-center pointer-events-none">
                  <div className="h-48 w-48 border border-info/50 rounded-2xl relative shadow-md">
                    <div className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-info"></div>
                    <div className="absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-info"></div>
                    <div className="absolute -left-1 -bottom-1 h-4 w-4 border-l-2 border-b-2 border-info"></div>
                    <div className="absolute -right-1 -bottom-1 h-4 w-4 border-r-2 border-b-2 border-info"></div>
                  </div>
                </div>
              )}
            </div>

            {!selectedOrderId && (
              <>
                {/* Error logs */}
                {scannerError && (
                  <div className="p-3 bg-danger-soft border border-danger/30 rounded-xl text-xs text-danger font-semibold text-center select-text">
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
                        ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--ink-muted)] hover:text-white hover:bg-[var(--surface-raised)]' 
                        : 'bg-info border-info hover:bg-blue-700 text-white'
                    }`}
                  >
                    {scannerActive ? (
                      <>
                        <Pause className="h-4 w-4 text-warning" />
                        Pause Scanner
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 text-success" />
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
                        className="w-full py-3.5 px-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-sm font-semibold text-zinc-200 outline-none cursor-pointer focus:border-[var(--border)] select-none appearance-none"
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
                <div className="pt-2 border-t border-[var(--border)]">
                  <button
                    onClick={() => setShowManualSearch(!showManualSearch)}
                    className="w-full text-center text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-muted)] flex items-center justify-center gap-1 py-2 cursor-pointer"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {showManualSearch ? 'Hide Keyboard Input' : 'Type Order ID Manually'}
                  </button>

                  {showManualSearch && (
                    <form onSubmit={handleManualSearchSubmit} className="mt-2 flex gap-2">
                      <Input
                        type="text"
                        placeholder="Type display ID, guest, etc."
                        className="flex-1 bg-[var(--surface)] border-[var(--border)] text-[var(--ink)] text-xs py-5 rounded-xl font-medium focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:border-info placeholder-[var(--ink-muted)] select-text"
                        value={manualSearch}
                        onChange={(e) => setManualSearch(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="px-4 py-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-xs font-bold text-white hover:bg-[var(--surface-raised)] cursor-pointer"
                      >
                        Load
                      </button>
                    </form>
                  )}
                </div>

                {/* Personal Packer Dashboard Statistics */}
                <div className="border border-[var(--border)] bg-zinc-900/10 rounded-2xl p-4 mt-4">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-550 block text-center mb-3">
                    Desk Packing stats today
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col p-2.5 rounded-xl bg-success-soft border border-success/25 text-center">
                      <span className="text-success text-lg font-black">{stats?.packed ?? 0}</span>
                      <span className="text-[9px] text-[var(--ink-muted)] font-bold uppercase tracking-wider">Packed</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl bg-warning-soft border border-warning/25 text-center">
                      <span className="text-warning text-lg font-black">{stats?.held ?? 0}</span>
                      <span className="text-[9px] text-[var(--ink-muted)] font-bold uppercase tracking-wider">Held</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl bg-info-soft border border-info/25 text-center">
                      <span className="text-info text-lg font-black">{stats?.pending ?? 0}</span>
                      <span className="text-[9px] text-[var(--ink-muted)] font-bold uppercase tracking-wider">Queue</span>
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
              <div className="text-center py-10 text-[var(--ink-muted)] text-sm">Loading packed logs...</div>
            ) : packedLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-2xl p-6 text-[var(--ink-muted)] space-y-2">
                <CheckCircle2 className="h-8 w-8 text-[var(--ink-muted)] mx-auto" />
                <p className="font-semibold text-sm">No packed logs found today</p>
                <p className="text-xs text-zinc-600">Scan and complete packing to see them here.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {packedLogs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => setViewedPackedOrder(log)}
                    className="p-3.5 bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border)] rounded-2xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex flex-col text-start">
                      <span className="font-mono text-sm font-bold text-white">{log.displayId}</span>
                      <span className="text-[10px] text-[var(--ink-muted)] mt-0.5">
                        {new Date(log.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-success-soft border border-success/25 text-success uppercase tracking-wider">
                        Packed
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
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
              <div className="text-center py-10 text-[var(--ink-muted)] text-sm">Loading hold list...</div>
            ) : heldLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-2xl p-6 text-[var(--ink-muted)] space-y-2">
                <AlertTriangle className="h-8 w-8 text-[var(--ink-muted)] mx-auto" />
                <p className="font-semibold text-sm">No orders currently on hold</p>
                <p className="text-xs text-zinc-600">Held orders will show up here for easy resumption.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {heldLogs.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => setViewedHeldOrder(order)}
                    className="p-3.5 bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border)] rounded-2xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex flex-col text-start">
                      <span className="font-mono text-sm font-bold text-white">{order.displayId}</span>
                      <span className="text-[10px] text-warning/80 font-medium mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        On hold ({order.totalItems} items)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-warning-soft border border-warning/25 text-warning uppercase tracking-wider">
                        Held
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. visual Details Active Order Overlay (Carousel layout) */}
        {selectedOrderId && activeOrder && (
          <div className="absolute inset-0 z-40 bg-[var(--canvas)] flex flex-col h-full overflow-hidden">
            {/* Overlay Header */}
            <div className="h-14 shrink-0 px-4 border-b border-[var(--border)] bg-zinc-900/60 flex items-center justify-between">
              <button
                onClick={handleBackAndRelease}
                className="p-2 hover:bg-[var(--surface-raised)] rounded-xl text-zinc-450 hover:text-white transition-colors cursor-pointer border border-[var(--border)] flex items-center justify-center shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="text-xs font-semibold pr-1">Back</span>
              </button>

              <div className="flex flex-col text-center">
                <span className="font-mono text-base font-extrabold text-white">
                  Order {activeOrder.displayId}
                </span>
                <span className="text-[9px] font-bold text-[var(--ink-muted)]">
                  {activeOrder.statusName} status
                </span>
              </div>

              {/* Progress counter */}
              <div className="flex items-center gap-1 select-none">
                <span className="text-[10px] px-2.5 py-1 rounded-full text-xs font-black bg-[var(--surface)] border border-[var(--border)] text-zinc-350">
                  {verifiedCount}/{totalItemCount} packed
                </span>
              </div>
            </div>

            {/* Carousel Item Viewport */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col justify-between space-y-4">
              
              {/* Locked Warning */}
              {activeOrder.packingLock && activeOrder.packingLock.packerId !== currentPackerId && (
                <div className="p-3.5 rounded-xl bg-warning-soft border border-warning/25 text-warning text-xs font-semibold flex items-center gap-2 select-none">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-warning" />
                  Locked by {activeOrder.packingLock.packerName}. Actions disabled.
                </div>
              )}

              {/* Active Product Swiper Card */}
              {activeOrder.items[currentProductIdx] ? (
                (() => {
                  const item = activeOrder.items[currentProductIdx]
                  const currentVerifiedQty = verifiedRef.current[item.id] ?? 0
                  const isVerified = currentVerifiedQty === item.quantity
                  const isMultiple = item.quantity > 1
                  // Canonical hierarchy: variant → color-sibling → product.
                  // A broken/missing variant image never hides which product
                  // the packer is looking at (fallback terminates at the
                  // controlled SafeImage placeholder).
                  // P1-9: only look up a catalog entry when we have BOTH ids.
                  // Keying on `?? ''` used to silently miss and could match a
                  // catalog variant whose id was itself null, showing the
                  // wrong product's photo.
                  const catalog = (item.productId
                    ? photoCatalog?.[item.productId]
                    : undefined) as ProductImageSource | null | undefined
                  const variant = (item.variantId && catalog
                    ? catalog?.variants?.find(
                        (v) => v.id != null && v.id === item.variantId,
                      )
                    : undefined) as ProductVariantImageSource | null | undefined
                  const resolvedImg = resolveOrderItemImages(
                    catalog ?? null,
                    variant ?? null,
                  )
                  const primaryImage = mediaUrl(
                    resolvedImg.image ?? item.image,
                  )
                  const fallbackImage = mediaUrl(
                    resolvedImg.colorImage ??
                      resolvedImg.productImage ??
                      item.fallbackImage,
                  )
                  const zoomSource = primaryImage || fallbackImage

                  return (
                    <div className="flex-1 flex flex-col justify-between space-y-4">
                      {/* Product Image Box */}
                      <div className="relative w-full h-56 md:h-72 shrink-0 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center overflow-hidden shadow-inner">
                        <SafeImage
                          src={primaryImage}
                          fallbackSrc={fallbackImage}
                          alt=""
                          className="h-full w-full object-contain cursor-zoom-in active:scale-95 transition-transform"
                          onClick={() => zoomSource && openZoom(zoomSource, fallbackImage)}
                        />

                        {/* Zoom magnifier indicator icon */}
                        {zoomSource && (
                          <button 
                            onClick={() => zoomSource && openZoom(zoomSource, fallbackImage)}
                            className="absolute right-3.5 bottom-3.5 p-2 rounded-xl bg-black/60 text-[var(--ink-muted)] border border-[var(--border)] hover:text-white transition-colors cursor-pointer"
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
                            <span className="text-xs font-bold text-[var(--ink-muted)] bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-0.5 rounded-lg">
                              {item.variantName}
                            </span>
                          )}
                          {item.sku && (
                            <span className="font-mono text-[10px] text-[var(--ink-muted)] bg-[var(--canvas)] px-2 py-0.5 rounded border border-[var(--border)] select-text selection:bg-info">
                              SKU: {item.sku}
                            </span>
                          )}
                        </div>

                        {/* Multiple Quantity warning blinks */}
                        {isMultiple && !isVerified && (
                          <div className="py-2.5 px-4 rounded-xl bg-danger-soft border border-danger/30 text-danger font-extrabold text-xs flex items-center justify-center gap-1.5 animate-pulse select-none">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
                            PACK {item.quantity} ITEMS! MULTIPLE QUANTITY DETECTED.
                          </div>
                        )}

                        {/* Strict Scan Guide banner */}
                        {!isVerified && (
                          <div className="py-2.5 px-4 rounded-xl bg-success-soft border border-success/30 text-success font-extrabold text-xs flex items-center justify-center gap-1.5 animate-pulse select-none">
                            <Scan className="h-4.5 w-4.5 shrink-0 text-success" />
                            {verificationMode === 'strict_scan' 
                              ? "SCAN PRODUCT SKU BARCODE TO PACK" 
                              : "SCAN BARCODE OR TAP BUTTON TO PACK"
                            }
                          </div>
                        )}
                      </div>

                      {/* Giant Qty Status Widget */}
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)]">
                        <span className="text-xs font-black text-zinc-450 uppercase tracking-wider select-none">
                          Items to Pack
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-2xl font-black px-4 py-1.5 rounded-xl border select-none ${
                            isVerified
                              ? 'bg-green-600/10 border-green-500 text-success'
                              : isMultiple
                                ? 'bg-warning-soft border-amber-500 text-amber-500'
                                : 'bg-info-soft border-info text-blue-500'
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
                                ? 'bg-[var(--canvas)] border border-[var(--border)] text-zinc-550 cursor-not-allowed opacity-70'
                                : 'bg-[var(--surface)] border border-[var(--border)] text-zinc-250 hover:bg-[var(--surface-raised)] cursor-pointer'
                          }`}
                        >
                          {isVerified ? (
                            <>
                              <Check className="h-4 w-4 stroke-[3]" />
                              Verified & Packed
                            </>
                          ) : verificationMode === 'strict_scan' ? (
                            <>
                              <Scan className="h-4 w-4 text-[var(--ink-muted)] animate-pulse" />
                              Scan Barcode to Verify ({currentVerifiedQty}/{item.quantity})
                            </>
                          ) : (
                            <>
                              <Check className="h-4 w-4 stroke-[3] text-[var(--ink-muted)] animate-pulse" />
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
                    className="p-2 border border-[var(--border)] rounded-xl hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-semibold text-[var(--ink-muted)]">
                    Product {currentProductIdx + 1} of {activeOrder.items.length} ({totalItemCount} total items)
                  </span>
                  <button
                    disabled={currentProductIdx === activeOrder.items.length - 1}
                    onClick={() => setCurrentProductIdx(prev => prev + 1)}
                    className="p-2 border border-[var(--border)] rounded-xl hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Toggle Customer Info Panel */}
              <div className="border border-[var(--border)] rounded-2xl overflow-hidden bg-zinc-900/20 shrink-0">
                <button
                  onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                  className="w-full px-4 py-3 flex items-center justify-between text-zinc-450 hover:text-white transition-all text-[11px] font-extrabold uppercase tracking-wider cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                    Customer & courier metadata
                  </span>
                  <span className="text-xs font-semibold text-blue-500">
                    {showCustomerDetails ? 'Hide' : 'View'}
                  </span>
                </button>

                {showCustomerDetails && (
                  <div className="px-5 py-4 border-t border-[var(--border)] text-start text-xs space-y-2 bg-zinc-900/10 text-[var(--ink-muted)] select-text">
                    <p><span className="text-[var(--ink-muted)] font-bold select-none">Name:</span> {activeOrder.customer?.name ?? 'Guest User'}</p>
                    <p><span className="text-[var(--ink-muted)] font-bold select-none">Phone:</span> {activeOrder.customer?.phone ?? 'N/A'}</p>
                    <p><span className="text-[var(--ink-muted)] font-bold select-none">Created Date:</span> {new Date(activeOrder.createdAt).toLocaleString()}</p>
                    <p><span className="text-[var(--ink-muted)] font-bold select-none">Order Status:</span> {activeOrder.statusName}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Giant Sticky actions drawer footer */}
            <div className="shrink-0 p-4 border-t border-[var(--border)] bg-zinc-900/60 flex items-center justify-between gap-3 select-none">
              <div className="flex gap-2">
                {/* Print */}
                <button
                  onClick={() => window.open(`/admin/op/print/sticker/${activeOrder.id}`, '_blank')}
                  className="p-4 rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-zinc-350 hover:text-white cursor-pointer"
                  title="Print sticker label"
                >
                  <Printer className="h-4 w-4" />
                </button>
                {/* Hold */}
                <button
                  onClick={() => handleHold(activeOrder.id)}
                  className="p-4 rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-warning hover:text-warning cursor-pointer"
                  title="Put order on hold"
                >
                  <AlertTriangle className="h-4 w-4" />
                </button>
              </div>

              {/* Giant packed done button */}
              <button
                disabled={
                  markDone.isPending ||
                  (activeOrder.packingLock
                    ? activeOrder.packingLock.packerId !== currentPackerId
                    : false)
                }
                onClick={() => handleDone(activeOrder.id)}
                className={`flex-1 py-4.5 rounded-2xl text-sm font-extrabold text-white transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] disabled:opacity-60 ${
                  isAllVerified
                    ? 'bg-green-600 hover:bg-green-700 animate-pulse-subtle'
                    : 'bg-[var(--surface-raised)] hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] border border-zinc-700/50'
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
        <nav className="h-16 shrink-0 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-around select-none">
          {/* Tab 1: Scanner */}
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'scan' ? 'text-blue-500 font-bold' : 'text-[var(--ink-muted)] hover:text-zinc-350'
            }`}
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px]">Scan & Pack</span>
          </button>

          {/* Tab 2: Packed Logs */}
          <button
            onClick={() => setActiveTab('packed')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'packed' ? 'text-blue-500 font-bold' : 'text-[var(--ink-muted)] hover:text-zinc-350'
            }`}
          >
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-[10px]">Packed ({packedLogs.length})</span>
          </button>

          {/* Tab 3: Held Logs */}
          <button
            onClick={() => setActiveTab('held')}
            className={`flex flex-col items-center justify-center w-20 h-full gap-1 cursor-pointer transition-colors ${
              activeTab === 'held' ? 'text-blue-500 font-bold' : 'text-[var(--ink-muted)] hover:text-zinc-350'
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
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-[var(--border)] pb-2.5">
              <span className="font-mono font-bold text-white">Packed Details {viewedPackedOrder.displayId}</span>
              <button onClick={() => setViewedPackedOrder(null)} className="p-1 rounded-full hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] select-none cursor-pointer">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-[var(--ink-muted)] text-start">
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Order status:</span> <span className="text-success font-semibold uppercase">Packed</span></p>
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Packed Timestamp:</span> {new Date(viewedPackedOrder.updatedAt).toLocaleString()}</p>
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Packer user:</span> {viewedPackedOrder.packerName}</p>
            </div>
            <div className="border-t border-[var(--border)] pt-2 text-start select-none">
              <button 
                onClick={() => setViewedPackedOrder(null)}
                className="w-full py-2.5 bg-[var(--surface-raised)] rounded-xl text-xs font-semibold hover:bg-[var(--surface-raised)] text-white cursor-pointer"
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
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-[var(--border)] pb-2.5">
              <span className="font-mono font-bold text-white">Held Details {viewedHeldOrder.displayId}</span>
              <button onClick={() => setViewedHeldOrder(null)} className="p-1 rounded-full hover:bg-[var(--surface-raised)] text-zinc-450 select-none cursor-pointer">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="text-xs space-y-2 text-[var(--ink-muted)] text-start">
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Order Status:</span> <span className="text-warning font-semibold uppercase">Packing Hold</span></p>
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Total Items:</span> {viewedHeldOrder.totalItems}</p>
              <p><span className="text-[var(--ink-muted)] font-bold select-none">Hold Timestamp:</span> {new Date(viewedHeldOrder.createdAt).toLocaleString()}</p>
              {viewedHeldOrder.customer && (
                <>
                  <p><span className="text-[var(--ink-muted)] font-bold select-none">Customer Name:</span> {viewedHeldOrder.customer.name}</p>
                  <p><span className="text-[var(--ink-muted)] font-bold select-none">Phone:</span> {viewedHeldOrder.customer.phone}</p>
                </>
              )}
            </div>
            <div className="flex gap-2.5 border-t border-[var(--border)] pt-3 select-none">
              <button 
                onClick={() => setViewedHeldOrder(null)}
                className="flex-1 py-2.5 bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] cursor-pointer"
              >
                Close
              </button>
              <button 
                onClick={() => {
                  const ordId = viewedHeldOrder.id
                  setViewedHeldOrder(null)
                  // P2-1: the order may no longer be in the polled queue —
                  // don't call openAndSelect(undefined) and throw.
                  const qItem = queue.find(q => q.id === ordId)
                  if (qItem) {
                    openAndSelect(qItem)
                  } else {
                    toast.error("This order is no longer in the packing queue.")
                  }
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
            className="absolute right-4 top-4 p-2 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-muted)] hover:text-white cursor-pointer"
          >
            <X className="h-6 w-6" />
          </button>
          <SafeImage src={zoomImage.src} fallbackSrc={zoomImage.fallbackSrc} alt="" className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl" />
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
    </div>
  )
}
