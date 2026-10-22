import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button, ButtonLink } from '../ui/Button'

/** Inline on desktop, fixed above phone navigation through a body portal. */
export function LaundryAddAction({ label, to, onClick, disabled = false }: {
  label: string; to?: string; onClick?: () => void; disabled?: boolean
}) {
  function render(floating: boolean) {
    const className = floating ? 'laundry-add-floating' : 'laundry-add-desktop'
    const children = <><Plus size={floating ? 25 : 18} aria-hidden="true" /><span>{label}</span></>
    return to ? <ButtonLink to={to} variant="primary" className={className} aria-label={label}>{children}</ButtonLink>
      : <Button className={className} onClick={onClick} disabled={disabled} aria-label={label}>{children}</Button>
  }
  return <>{render(false)}{createPortal(render(true), document.body)}</>
}
