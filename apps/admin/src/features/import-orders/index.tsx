import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Users,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { importOrdersApi, type OrderImportResult } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ImportOrders() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<OrderImportResult | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  const uploadMut = useMutation({
    mutationFn: () => importOrdersApi.upload(file!),
    onSuccess: (r) => {
      const d = r.data
      setResult(d)
      if (d.summary.errors > 0) {
        toast.warning(`Import completed with ${d.summary.errors} error(s)`)
      } else {
        toast.success('Import completed successfully')
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
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0] || null
    if (f && f.name.endsWith('.csv')) {
      setFile(f)
      setResult(null)
    } else {
      toast.error('Please drop a CSV file')
    }
  }

  const StatCard = ({
    label,
    value,
    icon,
    variant,
  }: {
    label: string
    value: number
    icon: React.ReactNode
    variant?: 'success' | 'danger' | 'warning' | 'info'
  }) => (
    <Card
      className={
        variant === 'success'
          ? 'border-emerald-200 bg-emerald-50/50'
          : variant === 'danger'
            ? 'border-red-200 bg-red-50/50'
            : variant === 'warning'
              ? 'border-amber-200 bg-amber-50/50'
              : ''
      }
    >
      <CardContent className='p-4 flex items-center gap-3'>
        <div
          className={`shrink-0 ${
            variant === 'success'
              ? 'text-emerald-600'
              : variant === 'danger'
                ? 'text-red-600'
                : variant === 'warning'
                  ? 'text-amber-600'
                  : 'text-blue-600'
          }`}
        >
          {icon}
        </div>
        <div>
          <p className='text-2xl font-bold'>{value}</p>
          <p className='text-xs text-muted-foreground'>{label}</p>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <>
      <Header fixed>
        <div className='me-auto'>
          <h1 className='text-lg font-semibold'>Import Orders</h1>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6 max-w-4xl'>
        <Card>
          <CardHeader>
            <CardTitle>WooCommerce Order Import</CardTitle>
            <CardDescription>
              Upload a WooCommerce order export CSV file. Orders will be imported with their line
              items. Customers will be created automatically from billing phone numbers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-4'>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className='border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer'
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.csv'
                  onChange={handleFileChange}
                  className='hidden'
                />
                {file ? (
                  <div className='flex items-center justify-center gap-3'>
                    <FileText className='h-8 w-8 text-primary' />
                    <div className='text-left'>
                      <p className='font-medium'>{file.name}</p>
                      <p className='text-xs text-muted-foreground'>
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={(e) => {
                        e.stopPropagation()
                        setFile(null)
                        setResult(null)
                      }}
                    >
                      <XCircle className='h-4 w-4' />
                    </Button>
                  </div>
                ) : (
                  <div className='text-muted-foreground'>
                    <Upload className='h-8 w-8 mx-auto mb-2' />
                    <p className='font-medium'>Drop a CSV file here or click to browse</p>
                    <p className='text-xs mt-1'>WooCommerce order export CSV format</p>
                  </div>
                )}
              </div>

              <Button
                onClick={() => uploadMut.mutate()}
                disabled={!file || uploadMut.isPending}
                className='w-full'
                size='lg'
              >
                {uploadMut.isPending ? (
                  <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                ) : (
                  <Upload className='h-4 w-4 mr-2' />
                )}
                {uploadMut.isPending ? 'Importing...' : 'Start Import'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {uploadMut.isPending && (
          <Card>
            <CardContent className='p-8 flex flex-col items-center gap-3'>
              <Loader2 className='h-8 w-8 animate-spin text-primary' />
              <p className='text-muted-foreground'>Processing orders... this may take a while for large files.</p>
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
                  <StatCard
                    label='Orders Imported'
                    value={result.summary.ordersImported}
                    icon={<ShoppingBag className='h-5 w-5' />}
                    variant='success'
                  />
                  <StatCard
                    label='Orders Skipped'
                    value={result.summary.ordersSkipped}
                    icon={<AlertTriangle className='h-5 w-5' />}
                    variant='warning'
                  />
                  <StatCard
                    label='Customers Created'
                    value={result.summary.customersCreated}
                    icon={<Users className='h-5 w-5' />}
                    variant='info'
                  />
                  <StatCard
                    label='Errors'
                    value={result.summary.errors}
                    icon={<XCircle className='h-5 w-5' />}
                    variant='danger'
                  />
                </div>
                <div className='grid grid-cols-2 md:grid-cols-3 gap-3 mt-3'>
                  <StatCard
                    label='Customers Found'
                    value={result.summary.customersFound}
                    icon={<Users className='h-5 w-5' />}
                    variant='success'
                  />
                </div>
              </CardContent>
            </Card>

            {result.errors.length > 0 && (
              <Card>
                <CardHeader
                  className='cursor-pointer'
                  onClick={() => setShowErrors(!showErrors)}
                >
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
                            <th className='text-left p-3 font-medium'>Order ID</th>
                            <th className='text-left p-3 font-medium'>Type</th>
                            <th className='text-left p-3 font-medium'>Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.errors.map((err, i) => (
                            <tr key={i} className='border-b last:border-0'>
                              <td className='p-3 text-muted-foreground'>{err.rowNumber || '-'}</td>
                              <td className='p-3 font-mono text-xs'>{err.orderId || '-'}</td>
                              <td className='p-3'>
                                <Badge variant='outline' className='text-xs'>
                                  {err.errorType}
                                </Badge>
                              </td>
                              <td
                                className='p-3 text-xs text-muted-foreground max-w-xs truncate'
                                title={err.message}
                              >
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

            {result.summary.ordersImported > 0 && (
              <Card>
                <CardContent className='p-6'>
                  <div className='text-sm text-muted-foreground space-y-1'>
                    <p>
                      <strong>Status mapping:</strong> <Badge variant='secondary'>completed</Badge> →{' '}
                      <Badge className='bg-emerald-100 text-emerald-700 hover:bg-emerald-100'>Delivered</Badge>
                      , <Badge variant='secondary'>cancelled</Badge> →{' '}
                      <Badge className='bg-red-100 text-red-700 hover:bg-red-100'>Cancelled</Badge>
                      , <Badge variant='secondary'>in-courier</Badge> →{' '}
                      <Badge className='bg-purple-100 text-purple-700 hover:bg-purple-100'>In-Courier</Badge>
                    </p>
                    <p>
                      <strong>Customers:</strong> Created from billing phone numbers. Completed orders
                      are marked as <Badge variant='secondary'>Delivered</Badge>.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Main>
    </>
  )
}
