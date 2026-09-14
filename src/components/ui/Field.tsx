import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-500" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-xs font-medium text-rose-600" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-gray-400">{hint}</span>
      ) : null}
    </label>
  )
}

const fieldClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#285A48]/60 focus:ring-2 focus:ring-[#285A48]/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-20 ${className}`} {...props} />
}
