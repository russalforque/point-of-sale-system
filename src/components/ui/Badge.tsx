export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'
  children: React.ReactNode
}) {
  const styles = {
    green: 'bg-green-50 text-green-800 border-green-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  }[tone]

  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>
  )
}

export function stockTone(status: string): 'green' | 'amber' | 'red' {
  if (status === 'Out of Stock') return 'red'
  if (status === 'Low Stock') return 'amber'
  return 'green'
}
