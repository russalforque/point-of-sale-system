import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck, Store } from '../components/ui/Icons'
import { useAuth } from '../context/AuthContext'
import { Field, Input } from '../components/ui/Field'
import { getErrorMessage } from '../utils/errors'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@sellix.local')
  const [password, setPassword] = useState('Admin123!')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submittingRef = useRef(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    // Guards against a double-tap or an Enter-key repeat firing a second
    // request before the busy state has re-rendered the disabled button.
    if (submittingRef.current) return
    submittingRef.current = true

    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f4f5f7] p-3 sm:p-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-[#091413]/10 bg-white shadow-[0_20px_50px_rgba(9,20,19,0.1)] lg:grid-cols-[0.85fr_1.15fr]">

        {/* =========================================================
            BRAND PANEL (tablet landscape / desktop only)
        ========================================================= */}

        <section className="hidden flex-col justify-between bg-[#0B1220] p-10 text-white lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#285A48] text-white">
              <Store size={20} />
            </div>
            <span className="text-sm font-bold tracking-[0.24em] text-white">SELLIX</span>
          </div>

          <div className="max-w-xs">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7fae9d]">
              Point of Sale
            </p>
            <p className="text-lg font-medium leading-7 text-white/90">
              Sign in to manage sales, inventory, and reports for your store.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/60">
            <ShieldCheck size={16} className="text-[#7fae9d]" />
            <span>Secure workspace access</span>
          </div>
        </section>

        {/* =========================================================
            LOGIN FORM
        ========================================================= */}

        <section className="flex items-center justify-center px-6 py-10 sm:px-10 lg:px-14 lg:py-12">
          <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B1220] text-white">
                <Store size={20} />
              </div>
              <span className="text-sm font-bold tracking-[0.24em] text-[#091413]">SELLIX</span>
            </div>

            <div className="mb-7">
              <h1 className="text-2xl font-bold tracking-tight text-[#091413] sm:text-[28px]">
                Sign in to Sellix
              </h1>
              <p className="mt-2 text-sm leading-6 text-[#091413]/50">
                Enter your workspace credentials to access the store's point of sale.
              </p>
            </div>

            <div className="space-y-4">
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  disabled={busy}
                  className="mt-1 min-h-12 px-3.5 text-[15px]"
                />
              </Field>

              <Field label="Password">
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={busy}
                    className="min-h-12 px-3.5 pr-12 text-[15px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={busy}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#091413]/40 transition-colors hover:text-[#091413] disabled:opacity-50"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </Field>
            </div>

            {error ? (
              <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-lg bg-[#285A48] text-base font-semibold text-white shadow-xs transition-colors hover:bg-[#204639] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              )}
              <span>{busy ? 'Signing in…' : 'Sign in'}</span>
            </button>

            <p className="mt-5 text-center text-xs text-[#091413]/40">Authorized team members only</p>
          </form>
        </section>
      </div>
    </div>
  )
}
