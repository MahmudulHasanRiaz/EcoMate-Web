interface Props { onClosed: () => void }

export function SessionClosePage({ onClosed }: Props) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-100 text-xl text-gray-500">
      Session Close — coming soon
    </div>
  )
}
