import { useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { ROLE_LABELS, type Role } from '../utils/permissions'

export function AccessDeniedPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const roleLabel = user?.role ? ROLE_LABELS[user.role as Role] ?? user.role : null

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-[#F6F8F7] px-6 py-10 text-[#091413]">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <LockIcon />
        </span>

        <h1 className="mt-5 text-xl font-bold tracking-tight">You don’t have access to this page</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {roleLabel ? `Your account is a ${roleLabel}, which can’t open this page.` : 'Your account can’t open this page.'} Ask your store admin if you
          need access.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-12 flex-1 rounded-full bg-white text-sm font-medium ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard', { replace: true })}
            className="h-12 flex-1 rounded-full bg-[#1F5E3B] text-sm font-semibold text-white transition active:scale-[0.99]"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default AccessDeniedPage
