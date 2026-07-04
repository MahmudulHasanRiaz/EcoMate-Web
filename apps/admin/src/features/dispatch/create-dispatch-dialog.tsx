import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectDropdown } from '@/components/select-dropdown'
import { useDispatchMutations } from './hooks'
import { COURIER_OPTIONS } from './data/data'

type CreateDispatchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const formSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  courier: z.string().min(1, 'Courier is required'),
  consignmentId: z.string().min(1, 'Consignment ID is required'),
  trackingCode: z.string().optional(),
  notes: z.string().optional(),
})

type DispatchForm = z.infer<typeof formSchema>

export function CreateDispatchDialog({
  open,
  onOpenChange,
}: CreateDispatchDialogProps) {
  const { create } = useDispatchMutations()

  const form = useForm<DispatchForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      orderId: '',
      courier: '',
      consignmentId: '',
      trackingCode: '',
      notes: '',
    },
  })

  const onSubmit = (data: DispatchForm) => {
    create.mutateAsync(data).then(() => {
      onOpenChange(false)
      form.reset()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset()
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Create Dispatch</DialogTitle>
          <DialogDescription>
            Create a new dispatch record for an order.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='dispatch-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='orderId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='Enter order ID' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='courier'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Courier</FormLabel>
                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Select courier'
                    items={COURIER_OPTIONS.map((c) => ({
                      label: c.label,
                      value: c.value,
                    }))}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='consignmentId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consignment ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='Enter consignment ID' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='trackingCode'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tracking Code (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='Enter tracking code' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='notes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder='Add notes' rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            form='dispatch-form'
            type='submit'
            disabled={create.isPending}
          >
            {create.isPending && (
              <Loader2 className='mr-2 size-4 animate-spin' />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
