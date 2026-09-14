import type { ReactNode } from 'react'

export function FormSection({
  title,
  description,
  children,
  className = '',
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {title && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{title}</p>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  )
}
