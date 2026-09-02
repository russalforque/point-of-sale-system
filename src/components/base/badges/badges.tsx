import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'

export function Badge({
  size = 'sm',
  type = 'modern',
  children,
  className,
}: {
  size?: 'sm' | 'md'
  type?: 'modern' | 'pill-color'
  children: ReactNode
  className?: string
}) {
  const sizes = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm'
  const look =
    type === 'modern'
      ? 'rounded-md bg-white text-gray-600 ring-1 ring-inset ring-gray-300 shadow-xs'
      : 'rounded-full bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-200'

  return <span className={cx('inline-flex items-center font-medium', sizes, look, className)}>{children}</span>
}
