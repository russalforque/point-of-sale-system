import { ChevronLeft, ChevronRight } from './Icons'

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const buttonClass =
    'flex h-11 w-11 items-center justify-center rounded-full bg-[#F3F5F4] text-[#091413] transition active:scale-95 hover:bg-[#E9EEEB] disabled:bg-transparent disabled:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]'

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3 text-sm text-slate-500 sm:justify-end">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className={buttonClass}>
        <ChevronLeft size={14} />
      </button>
      <span aria-live="polite" className="tabular-nums">
        Page <span className="font-medium text-[#091413]">{page}</span> of {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" className={buttonClass}>
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
