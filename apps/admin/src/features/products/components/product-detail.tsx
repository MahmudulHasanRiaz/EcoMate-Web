import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeft, Package, Pencil, Trash2, Loader2 } from 'lucide-react'
import { productsApi, type ProductResponse } from '../api'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProductForm } from './product-form'
import { apiClient } from '@/lib/api-client'
import { ManagedStockAdjustmentModal } from './managed-stock-adjustment-modal'
import { UserBadge } from '@/components/user-badge'

export function ProductDetail() {
  const { id } = useParams({ from: '/_authenticated/op/products/$id' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => productsApi.get(id).then(r => r.data),
    enabled: !!id,
  })

  const deleteMut = useMutation({
    mutationFn: () => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product deleted')
      navigate({ to: '/op/products' })
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Delete failed'),
  })

  const { data: ledgerData } = useQuery({
    queryKey: ['product-ledger', product?.id],
    queryFn: () => apiClient.get('/inventory/ledger', { params: { productId: product?.id, perPage: 10 } }).then(r => r.data),
    enabled: !!product?.id,
  })

  if (isLoading) {
    return (
      <>
        <Header>
          <ProfileDropdown />
          <ThemeSwitch />
        </Header>
        <Main>
          <div className='flex justify-center py-20'>
            <Loader2 className='animate-spin h-8 w-8 text-muted-foreground' />
          </div>
        </Main>
      </>
    )
  }

  if (!product) {
    return (
      <>
        <Header>
          <ProfileDropdown />
          <ThemeSwitch />
        </Header>
        <Main>
          <div className='text-center py-20'>
            <p className='text-muted-foreground'>Product not found.</p>
            <Button variant='outline' className='mt-4' onClick={() => navigate({ to: '/op/products' })}>
              Back to products
            </Button>
          </div>
        </Main>
      </>
    )
  }

  const images = Array.isArray(product.images) ? product.images : []
  const variants = product.variants || []
  const p = product as any
  const categories = p.productCategories || []
  const isVar = product.type === 'variable'

  return (
    <>
      <Header>
        <ProfileDropdown />
        <ThemeSwitch />
      </Header>
      <Main>
        <div className='mb-6 flex items-center gap-4'>
          <Button variant='ghost' size='icon' onClick={() => navigate({ to: '/op/products' })}>
            <ArrowLeft className='h-5 w-5' />
          </Button>
          <div className='flex-1'>
            <h1 className='text-2xl font-bold tracking-tight'>{product.name}</h1>
            {product.sku && <p className='text-sm text-muted-foreground'>SKU: {product.sku}</p>}
          </div>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' onClick={() => setFormOpen(true)}>
              <Pencil className='h-4 w-4 mr-1' /> Edit
            </Button>
            <Button variant='destructive' size='sm' onClick={() => { if (confirm('Delete this product?')) deleteMut.mutate() }}>
              <Trash2 className='h-4 w-4 mr-1' /> Delete
            </Button>
          </div>
        </div>

        <div className='grid gap-6 lg:grid-cols-3'>
          <div className='lg:col-span-2 space-y-6'>
            <Card>
              <CardHeader><CardTitle className='text-base'>Images</CardTitle></CardHeader>
              <CardContent>
                {images.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>No images.</p>
                ) : (
                  <div className='flex gap-3 flex-wrap'>
                    {images.map((img: any, i: number) => (
                      <SafeImage key={i} src={mediaUrl(typeof img === 'string' ? img : img)} alt='' className='w-24 h-24 rounded-md border object-cover' thumbWidth={120} thumbHeight={120} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className='text-base'>Description</CardTitle></CardHeader>
              <CardContent>
                {product.description ? (
                  <div
                    className='text-sm text-muted-foreground [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline'
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                ) : (
                  <p className='text-sm text-muted-foreground'>No description.</p>
                )}
              </CardContent>
            </Card>

            {variants.length > 0 && (
              <Card>
                <CardHeader><CardTitle className='text-base'>Variants ({variants.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-sm'>
                      <thead>
                        <tr className='border-b text-left text-muted-foreground'>
                          <th className='pb-2 font-medium'>SKU</th>
                          <th className='pb-2 font-medium'>Attributes</th>
                          <th className='pb-2 font-medium text-right'>Price</th>
                          <th className='pb-2 font-medium text-right'>Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v: any) => (
                          <tr key={v.id} className='border-b last:border-0'>
                            <td className='py-2 font-mono text-xs'>{v.sku || '—'}</td>
                            <td className='py-2'>
                              {(v.attributeValues || []).map((av: any) => (
                                <Badge key={av.id} variant='outline' className='mr-1 text-[10px]'>
                                  {av.attributeValue?.attribute?.name}: {av.attributeValue?.value}
                                </Badge>
                              ))}
                            </td>
                            <td className='py-2 text-right font-medium'>
                              {v.salePrice ? (
                                <><span className='line-through text-muted-foreground text-xs mr-1'>৳{Number(v.price).toFixed(2)}</span>৳{Number(v.salePrice).toFixed(2)}</>
                              ) : v.price ? `৳${Number(v.price).toFixed(2)}` : '—'}
                            </td>
                            <td className='py-2 text-right flex items-center justify-end gap-1.5'>
                              {p.availabilityMode === 'ALWAYS_IN_STOCK' ? <Badge variant='outline' className='text-xs'>∞</Badge> :
                               p.availabilityMode === 'INVENTORY_CONTROLLED' ? <Badge variant='outline' className='text-xs text-muted-foreground'>—</Badge> :
                               <Badge variant={v.managedStockQuantity > 0 ? 'outline' : 'destructive'} className='text-xs'>{v.managedStockQuantity}</Badge>}
                              {p.availabilityMode === 'MANAGED_STOCK' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() => {
                                    setActiveVariantId(v.id)
                                    setAdjustmentModalOpen(true)
                                  }}
                                  title="Adjust Stock"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className='space-y-6'>
            <Card>
              <CardHeader><CardTitle className='text-base'>Details</CardTitle></CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <div className='flex justify-between'><span className='text-muted-foreground'>Type</span><Badge variant='outline' className='capitalize'>{product.type}</Badge></div>
                <div className='flex justify-between'><span className='text-muted-foreground'>Availability</span><Badge variant='outline' className='font-mono text-[10px]'>{product.availabilityMode || '—'}</Badge></div>
                <div className='flex justify-between'><span className='text-muted-foreground'>Slug</span><span className='font-mono text-xs'>{product.slug}</span></div>
                <div className='flex justify-between'><span className='text-muted-foreground'>Price</span><span className='font-medium'>৳{Number(product.basePrice).toFixed(2)}</span></div>
                {product.salePrice != null && <div className='flex justify-between'><span className='text-muted-foreground'>Sale Price</span><span className='font-medium text-green-600'>৳{Number(product.salePrice).toFixed(2)}</span></div>}
                <div className='flex justify-between items-center'>
                  <span className='text-muted-foreground'>Stock</span>
                  <div className='flex items-center gap-1.5'>
                    <Badge variant={
                      product.availabilityMode === 'ALWAYS_IN_STOCK' ? 'outline' :
                      product.availabilityMode === 'INVENTORY_CONTROLLED' ? 'secondary' :
                      product.managedStockQuantity > 0 ? 'outline' : 'destructive'
                    }>
                      {product.availabilityMode === 'ALWAYS_IN_STOCK' ? '∞ Unlimited' :
                       product.availabilityMode === 'INVENTORY_CONTROLLED' ? '0 (Track via PO)' :
                       isVar ? `From ${variants.reduce((s, v: any) => s + v.managedStockQuantity, 0)}` :
                       product.managedStockQuantity}
                    </Badge>
                    {!isVar && product.availabilityMode === 'MANAGED_STOCK' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => {
                          setActiveVariantId(null)
                          setAdjustmentModalOpen(true)
                        }}
                        title="Adjust Stock"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className='flex justify-between'><span className='text-muted-foreground'>Active</span><Badge variant={product.isActive ? 'default' : 'secondary'} className={product.isActive ? 'bg-green-500' : ''}>{product.isActive ? 'Yes' : 'No'}</Badge></div>
                <div className='flex justify-between'><span className='text-muted-foreground'>Featured</span><span>{product.isFeatured ? 'Yes' : 'No'}</span></div>
                {product.brandId && <div className='flex justify-between'><span className='text-muted-foreground'>Brand</span><span>{p.brand?.name || product.brandId}</span></div>}
                {product.category && <div className='flex justify-between'><span className='text-muted-foreground'>Category</span><span>{(product.category as any)?.name}</span></div>}
              </CardContent>
            </Card>

            {ledgerData?.data?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className='text-base'>Stock History</CardTitle></CardHeader>
                <CardContent>
                  <div className='space-y-2 max-h-48 overflow-y-auto'>
                    {ledgerData.data.map((entry: any) => (
                      <div key={entry.id} className='flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0'>
                        <div className='flex items-center gap-2'>
                          <Badge variant={entry.direction === 'IN' ? 'default' : 'destructive'} className='text-[10px] px-1 py-0 h-4'>
                            {entry.direction === 'IN' ? '+' : '-'}{entry.quantity}
                          </Badge>
                          <span className='text-muted-foreground capitalize'>{entry.type.replace(/_/g, ' ').toLowerCase()}</span>
                        </div>
                        <div className='text-muted-foreground'>
                          {entry.stockBefore} → {entry.stockAfter}
                          {entry.performedBy && (
                            <span className='ml-2 inline-flex items-center'>
                              {entry.performedBy.toLowerCase() !== 'system' ? (
                                <UserBadge email={entry.performedBy} showEmail={false} size="sm" />
                              ) : (
                                <Badge variant="secondary" className="text-[10px] h-4">System</Badge>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(ledgerData.meta?.totalPages || 0) > 1 && (
                    <p className='text-xs text-muted-foreground mt-2 text-center'>
                      +{ledgerData.meta.total - 10} more entries
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {categories.length > 0 && (
              <Card>
                <CardHeader><CardTitle className='text-base'>All Categories</CardTitle></CardHeader>
                <CardContent className='flex flex-wrap gap-2'>
                  {categories.map((pc: any) => (
                    <Badge key={pc.categoryId} variant='secondary'>{pc.category?.name || pc.categoryId}</Badge>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className='text-base'>SEO Meta</CardTitle></CardHeader>
              <CardContent className='space-y-2 text-sm'>
                {product.seoMeta ? (
                  <>
                    <div><span className='text-muted-foreground'>Title: </span>{(product.seoMeta as any)?.seo_title || '—'}</div>
                    <div><span className='text-muted-foreground'>Description: </span>{(product.seoMeta as any)?.seo_description || '—'}</div>
                    <div><span className='text-muted-foreground'>Stock Status: </span>{(product.seoMeta as any)?.stockStatus || '—'}</div>
                  </>
                ) : <p className='text-muted-foreground'>No SEO data.</p>}
              </CardContent>
            </Card>
          </div>
        </div>

        <ProductForm open={formOpen} onOpenChange={setFormOpen} currentRow={product as any} mode='edit' />
        {adjustmentModalOpen && product?.id && (
          <ManagedStockAdjustmentModal
            open={adjustmentModalOpen}
            onOpenChange={(v) => {
              setAdjustmentModalOpen(v)
              if (!v) {
                queryClient.invalidateQueries({ queryKey: ['product', product.id] })
                queryClient.invalidateQueries({ queryKey: ['product-ledger', product.id] })
              }
            }}
            initialProductId={product.id}
            initialVariantId={activeVariantId || undefined}
          />
        )}
      </Main>
    </>
  )
}
