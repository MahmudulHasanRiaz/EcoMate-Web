import { AxiosError } from 'axios'
import { toast } from 'sonner'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = 'Something went wrong!'

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'No content.'
  }

  if (error instanceof AxiosError) {
    const data = error.response?.data
    const title = data?.title
    const message = data?.message
    if (typeof title === 'string' && title.length > 0) {
      errMsg = title
    } else if (typeof message === 'string' && message.length > 0) {
      errMsg = message
    } else if (typeof error.message === 'string' && error.message.length > 0) {
      errMsg = error.message
    }
  }

  toast.error(errMsg)
}
