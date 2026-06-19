import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { importApi, type ImportResult, type ImportError, type ImportJobStatus } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ImportProducts() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'create' | 'update'>('create')
  const [dryRun, setDryRun] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [activeJob, setActiveJob] = useState<ImportJobStatus | null>(null)
  const [polling, setPolling] = useState(false)

  // Use a ref to store active polling state to avoid multiple parallel poll chains
  const pollingRef = useRef(false)

  const pollStatus = async (jobId: string) => {
    if (!pollingRef.current) return
    try {
      const response = await importApi.getStatus(jobId)
      const job = response.data
      setActiveJob(job)

      if (job.status === 'completed') {
        pollingRef.current = false
        setPolling(false)
        setResult({
          summary: job.summary!,
          errors: job.errors,
        })
        if (job.summary!.errors > 0) {
          toast.warning(`Import completed with ${job.summary!.errors} error(s)`)
        } else {
          toast.success('Import completed successfully')
        }
      } else if (job.status === 'failed') {
        pollingRef.current = false
        setPolling(false)
        toast.error(job.error || 'Import job failed')
      } else {
        // Keep polling
        setTimeout(() => pollStatus(jobId), 2000)
      }
    } catch (err) {
      pollingRef.current = false
      setPolling(false)
      toast.error('Failed to get import progress')
    }
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current = false
    }
  }, [])

  const uploadMut = useMutation({
    mutationFn: () => importApi.upload(file!, mode, dryRun),
    onSuccess: (r) => {
      const d = r.data
      if (d.jobId) {
        // Actual import started in background
        setResult(null)
        setActiveJob({
          id: d.jobId,
          type: 'products',
          status: 'processing',
          progress: { total: 100, processed: 0 },
          summary: null,
          errors: [],
          startedAt: new Date().toISOString(),
        })
        setPolling(true)
        pollingRef.current = true
        pollStatus(d.jobId)
      } else {
        // Dry run returned validation summary directly
        setResult({
          summary: d.summary!,
          errors: d.errors || [],
        })
        toast.success('Dry run completed successfully')
      }
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message
      toast.error(msg || 'Import failed')
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setActiveJob(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0] || null
    if (f && f.name.endsWith('.csv')) {
      setFile(f)
      setResult(null)
      setActiveJob(null)
    } else {
      toast.error('Please drop a CSV file')
    }
  }

  const StatCard = ({ label, value, icon, variant }: { label: string; value: number; icon: React.ReactNode; variant?: 'success' | 'danger' | 'warning' | 'info' }) => (
    <Card className={variant === 'success' ? 'border-emerald-200 bg-emerald-50/50' : variant === 'danger' ? 'border-red-200 bg-red-50/50' : variant === 'warning' ? 'border-amber-200 bg-amber-50/50' : ''}>
      <CardContent className='p-4 flex items-center gap-3'>
        <div className={`shrink-0 ${variant === 'success' ? 'text-emerald-600' : variant === 'danger' ? 'text-red-600' : variant === 'warning' ? 'text-amber-600' : 'text-blue-600'}`}>
          {icon}
        </div>
        <div>
          <p className='text-2xl font-bold'>{value}</p>
          <p className='text-xs text-muted-foreground'>{label}</p>
        </div>
      </CardContent>
    </Card>
  )

  const isImportRunning = !!(uploadMut.isPending || polling || (activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing')));

  return (
    <>
      <Header fixed>
        <div className='me-auto'>
          <h1 className='text-lg font-semibold'>Import Products</h1>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6 max-w-4xl'>
        <Card>
          <CardHeader>
            <CardTitle>WooCommerce CSV Import</CardTitle>
            <CardDescription>
              Upload a WooCommerce product export CSV file. Products are matched by SKU.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-4'>
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <label className='text-sm font-medium'>Mode:</label>
                  <div className='flex gap-1 border rounded-md p-0.5'>
                    <Button
                      variant={mode === 'create' ? 'default' : 'ghost'}
                      size='sm'
                      className='h-7 text-xs'
                      onClick={() => setMode('create')}
                      disabled={isImportRunning}
                    >
                      Create Only
                    </Button>
                    <Button
                      variant={mode === 'update' ? 'default' : 'ghost'}
                      size='sm'
                      className='h-7 text-xs'
                      onClick={() => setMode('update')}
                      disabled={isImportRunning}
                    >
                      Create & Update
                    </Button>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <label className='text-sm font-medium'>Dry Run:</label>
                  <Button
                    variant={dryRun ? 'default' : 'ghost'}
                    size='sm'
                    className='h-7 text-xs'
                    onClick={() => setDryRun(!dryRun)}
                    disabled={isImportRunning}
                  >
                    {dryRun ? 'ON' : 'OFF'}
                  </Button>
                </div>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className='border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer'
                onClick={() => !isImportRunning && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.csv'
                  onChange={handleFileChange}
                  className='hidden'
                  disabled={isImportRunning}
                />
                {file ? (
                  <div className='flex items-center justify-center gap-3'>
                    <FileText className='h-8 w-8 text-primary' />
                    <div className='text-left'>
                      <p className='font-medium'>{file.name}</p>
                      <p className='text-xs text-muted-foreground'>{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    {!isImportRunning && (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); setActiveJob(null); }}
                      >
                        <XCircle className='h-4 w-4' />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className='text-muted-foreground'>
                    <Upload className='h-8 w-8 mx-auto mb-2' />
                    <p className='font-medium'>Drop a CSV file here or click to browse</p>
                    <p className='text-xs mt-1'>WooCommerce product export CSV format</p>
                  </div>
                )}
              </div>

              <Button
                onClick={() => uploadMut.mutate()}
                disabled={!file || isImportRunning}
                className='w-full'
                size='lg'
              >
                {isImportRunning ? (
                  <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                ) : (
                  <Upload className='h-4 w-4 mr-2' />
                )}
                {isImportRunning ? 'Importing...' : dryRun ? 'Validate CSV' : 'Start Import'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {isImportRunning && (
          <Card className="border-blue-200 bg-blue-50/20">
            <CardContent className='p-8 flex flex-col items-center gap-4'>
              <Loader2 className='h-8 w-8 animate-spin text-primary' />
              <div className="w-full text-center">
                <p className='font-semibold text-blue-900'>
                  {uploadMut.isPending
                    ? 'Uploading and parsing CSV...'
                    : `Importing products... (${activeJob?.progress.processed ?? 0} / ${activeJob?.progress.total ?? 0})`}
                </p>
                {activeJob && activeJob.progress.total > 0 && (
                  <div className="mt-3 w-full bg-slate-200 rounded-full h-2.5 overflow-hidden max-w-md mx-auto">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            2,
                            ((activeJob.progress.processed ?? 0) / (activeJob.progress.total ?? 1)) * 100
                          )
                        )}%`,
                      }}
                    ></div>
                  </div>
                )}
                <p className='text-xs text-muted-foreground mt-2'>
                  The import is running securely in the background. You can safely stay on this page to monitor progress.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <CheckCircle className='h-5 w-5 text-emerald-600' />
                  Import Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
                  <StatCard label='Created' value={result.summary.productsCreated} icon={<CheckCircle className='h-5 w-5' />} variant='success' />
                  <StatCard label='Updated' value={result.summary.productsUpdated} icon={<CheckCircle className='h-5 w-5' />} variant='info' />
                  <StatCard label='Skipped' value={result.summary.productsSkipped} icon={<AlertTriangle className='h-5 w-5' />} variant='warning' />
                  <StatCard label='Errors' value={result.summary.errors} icon={<XCircle className='h-5 w-5' />} variant='danger' />
                </div>

                <div className='grid grid-cols-2 md:grid-cols-4 gap-3 mt-3'>
                  <StatCard label='Categories Created' value={result.summary.categoriesCreated} icon={<CheckCircle className='h-5 w-5' />} variant='success' />
                  <StatCard label='Categories Reused' value={result.summary.categoriesReused} icon={<CheckCircle className='h-5 w-5' />} variant='info' />
                  <StatCard label='Attributes' value={result.summary.attributesImported} icon={<CheckCircle className='h-5 w-5' />} variant='info' />
                  <StatCard label='Variants' value={result.summary.variantsImported} icon={<CheckCircle className='h-5 w-5' />} variant='info' />
                </div>

                <div className='grid grid-cols-2 md:grid-cols-4 gap-3 mt-3'>
                  <StatCard label='Images Downloaded' value={result.summary.imagesDownloaded} icon={<Download className='h-5 w-5' />} variant='info' />
                  <StatCard label='Images Imported' value={result.summary.imagesImported} icon={<CheckCircle className='h-5 w-5' />} variant='success' />
                  <StatCard label='Images Reused' value={result.summary.imagesReused} icon={<CheckCircle className='h-5 w-5' />} variant='info' />
                  <StatCard label='Images Failed' value={result.summary.imagesFailed} icon={<XCircle className='h-5 w-5' />} variant='danger' />
                </div>
              </CardContent>
            </Card>

            {result.errors.length > 0 && (
              <Card>
                <CardHeader className='cursor-pointer' onClick={() => setShowErrors(!showErrors)}>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <AlertTriangle className='h-5 w-5 text-amber-600' />
                    Error Log ({result.errors.length})
                    <span className='ml-auto'>
                      {showErrors ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                    </span>
                  </CardTitle>
                </CardHeader>
                {showErrors && (
                  <CardContent className='p-0'>
                    <div className='overflow-x-auto'>
                      <table className='w-full text-sm'>
                        <thead>
                          <tr className='border-b bg-muted/50'>
                            <th className='text-left p-3 font-medium'>Row</th>
                            <th className='text-left p-3 font-medium'>SKU</th>
                            <th className='text-left p-3 font-medium'>Type</th>
                            <th className='text-left p-3 font-medium'>Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.errors.map((err, i) => (
                            <tr key={i} className='border-b last:border-0'>
                              <td className='p-3 text-muted-foreground'>{err.rowNumber || '-'}</td>
                              <td className='p-3 font-mono text-xs'>{err.sku || '-'}</td>
                              <td className='p-3'>
                                <Badge variant='outline' className='text-xs'>{err.errorType}</Badge>
                              </td>
                              <td className='p-3 text-xs text-muted-foreground max-w-xs truncate' title={err.message}>
                                {err.message}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            )}
          </>
        )}
      </Main>
    </>
  )
}
