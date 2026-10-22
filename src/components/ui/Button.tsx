import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function buttonClasses(variant: ButtonVariant = 'primary') {
  const styles = {
    primary: 'bg-[#1F5E3B] text-white hover:bg-[#194D30]',
    secondary: 'bg-white text-[#091413] ring-1 ring-slate-200 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'text-slate-600 hover:bg-[#F3F5F4] hover:text-[#091413]',
  }[variant]
  return `inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:ring-0 disabled:active:scale-100 ${styles}`
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  children: ReactNode
}

/** Pill button matching the rest of Sellix (brand green primary, 44px touch height). */
export function Button({ variant = 'primary', className = '', type = 'button', children, ...props }: Props) {
  return (
    <button
      type={type}
      className={`${buttonClasses(variant)} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/** Links and submit buttons share the same Sellix treatment. */
export function ButtonLink({ variant = 'secondary', className = '', ...props }: LinkProps & { variant?: ButtonVariant }) {
  return <Link className={`${buttonClasses(variant)} ${className}`} {...props} />
}
