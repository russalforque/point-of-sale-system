import { User01 } from '@untitledui/icons'
import { useState } from 'react'
import { cx } from '@/utils/cx'

export function Avatar({
  src,
  alt = '',
  initials,
  className,
  size = 'md',
}: {
  src?: string | null
  alt?: string
  initials?: string
  className?: string
  size?: 'xs' | 'sm' | 'md'
}) {
  const [failed, setFailed] = useState(false)
  const sizes = { xs: 'size-5', sm: 'size-8', md: 'size-10' }[size]
  const showImage = Boolean(src) && !failed

  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-gray-600',
        sizes,
        className,
      )}
    >
      {showImage ? (
        <img src={src ?? undefined} alt={alt} className="size-full object-cover" onError={() => setFailed(true)} />
      ) : initials ? (
        <span className="text-[10px] font-semibold">{initials}</span>
      ) : (
        <User01 className="size-3.5" />
      )}
    </span>
  )
}
