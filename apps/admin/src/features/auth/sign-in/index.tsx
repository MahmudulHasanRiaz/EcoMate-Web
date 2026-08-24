import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CircleAlert } from 'lucide-react'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect, expired } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>Sign in</CardTitle>
          <CardDescription>
            Enter your email and password below to log into{' '}
            <br className='max-sm:hidden' /> your account. Don't have an
            account?{' '}
            <Link
              to='/sign-up'
              className='text-nowrap underline underline-offset-4 hover:text-primary'
            >
              Sign Up
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expired === '1' && (
            <div
              role='status'
              className='mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            >
              <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            By clicking sign in, you agree to our{' '}
            <a
              href='/terms'
              className='underline underline-offset-4 hover:text-primary'
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href='/privacy'
              className='underline underline-offset-4 hover:text-primary'
            >
              Privacy Policy
            </a>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
