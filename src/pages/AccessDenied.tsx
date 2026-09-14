import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ROLE_LABELS } from '../utils/permissions'

export function AccessDeniedPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-[#E5EBE7] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
          <ShieldXIcon size={28} />
        </div>

        <h1 className="mt-4 text-lg font-black text-[#091413]">Access Denied</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {user
            ? `Your account (${ROLE_LABELS[user.role]}) doesn't have permission to view this page.`
            : "You don't have permission to view this page."}
        </p>

        <button
          type="button"
          onClick={() => navigate('/dashboard', { replace: true })}
          className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#285A48] text-sm font-bold text-white shadow-md shadow-[#285A48]/20 active:scale-95 touch-manipulation"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}

function ShieldXIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <line x1="9.5" y1="9.5" x2="14.5" y2="14.5" />
      <line x1="14.5" y1="9.5" x2="9.5" y2="14.5" />
    </svg>
  )
}

export default AccessDeniedPage
