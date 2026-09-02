import { ChevronLeft, ChevronRight } from 'lucide-react'

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

  return (
    <div className="flex items-center justify-end gap-2 pt-3 text-sm text-gray-600">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded border border-gray-300 bg-white p-1 disabled:opacity-40"
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="rounded border border-gray-300 bg-white p-1 disabled:opacity-40"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
