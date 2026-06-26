import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import axios from 'axios'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email.' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(6, 'Password must be at least 6 characters long.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

    try {
      // Retry on network errors (ECONNREFUSED during backend startup race)
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const response = await axios.post(
            `${API_URL}/auth/login`,
            { email: data.email, password: data.password },
            { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
          )

          auth.setUser(response.data.user)
          auth.setAccessToken(response.data.accessToken)

          const targetPath = redirectTo || '/'
          navigate({ to: targetPath, replace: true })

          toast.success(`Welcome back!`)
          return
        } catch (error: any) {
          // Only retry on network errors (no response from server)
          if (attempt < 3 && !error.response) {
            const delay = 500 * Math.pow(2, attempt)
            console.warn(`[login] Retry ${attempt + 1}/3 in ${delay}ms`)
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          throw error
        }
      }
    } catch (error: any) {
      let message = error.response?.data?.message
      if (!message) {
        message = error.response
          ? `Server error (${error.response.status})`
          : 'Network error. Please check your connection.'
      }
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder='name@example.com' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='absolute inset-e-0 -top-0.5 text-sm font-medium text-muted-foreground hover:opacity-75'
              >
                Forgot password?
              </Link>
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in
        </Button>
      </form>
    </Form>
  )
}
