export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'
  children: React.ReactNode
}) {
  const styles = {
    green: 'bg-[#E6F1EA] text-[#1F5E3B]',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-rose-50 text-rose-700',
    gray: 'bg-[#F3F5F4] text-slate-600',
    blue: 'bg-sky-50 text-sky-800',
  }[tone]

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>{children}</span>
  )
}

export function stockTone(status: string): 'green' | 'amber' | 'red' {
  if (status === 'Out of Stock') return 'red'
  if (status === 'Low Stock') return 'amber'
  return 'green'
}
