import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import sellixMark from '../assets/sellix-mark.png'
import { ShieldCheck } from '../components/ui/Icons'
import { EMAIL_PATTERN, PrimaryButton, TextField } from '../components/ui/MobileKit'
import { useAuth } from '../context/AuthContext'
import { ApiError, getErrorMessage } from '../utils/errors'

type FieldName = 'email' | 'password'
type FieldErrors = Partial<Record<FieldName, string>>

/**
 * Development-only shortcuts. These mirror the seeded demo accounts in authApi and
 * are stripped from production builds, so real installs start with an empty form.
 */
const DEMO_ACCOUNTS = import.meta.env.DEV
  ? [
      { label: 'Admin', email: 'admin@sellix.local', password: 'Admin123!' },
      { label: 'Manager', email: 'manager@sellix.local', password: 'Manager123!' },
      { label: 'Cashier', email: 'cashier@sellix.local', password: 'Cashier123!' },
    ]
  : []

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  const trimmed = email.trim()
  if (!trimmed) errors.email = 'Enter your email.'
  else if (!EMAIL_PATTERN.test(trimmed)) errors.email = 'Enter a valid email, like name@store.com.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState(DEMO_ACCOUNTS[0]?.email ?? '')
  const [password, setPassword] = useState(DEMO_ACCOUNTS[0]?.password ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const formRef = useRef<HTMLFormElement | null>(null)
  const submittingRef = useRef(false)

  function focusField(name: FieldName, select = false) {
    const input = formRef.current?.elements.namedItem(name)
    if (input instanceof HTMLInputElement) {
      input.focus()
      if (select) input.select()
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    // Guards against a double-tap or an Enter-key repeat firing a second
    // request before the busy state has re-rendered the button.
    if (submittingRef.current) return

    const errors = validate(email, password)
    setFieldErrors(errors)
    setFormError(null)
    if (errors.email || errors.password) {
      focusField(errors.email ? 'email' : 'password')
      return
    }

    submittingRef.current = true
    setBusy(true)
    try {
      // Accounts are stored lower-case; trimming avoids failures from a stray space.
      await login(email.trim().toLowerCase(), password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Keep what they typed so a single typo is quick to fix.
        setFieldErrors({ password: 'Incorrect email or password. Check both and try again.' })
        focusField('password', true)
      } else {
        setFormError(getErrorMessage(err))
      }
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  function handleEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // "Next" on the keyboard moves to the password instead of submitting a half-filled form.
    if (event.key === 'Enter' && !password) {
      event.preventDefault()
      focusField('password')
    }
  }

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(event.getModifierState('CapsLock'))
  }

  function fillDemoAccount(account: { email: string; password: string }) {
    setEmail(account.email)
    setPassword(account.password)
    setFieldErrors({})
    setFormError(null)
  }

  return (
    <div className="flex min-h-full bg-white text-[#091413] antialiased lg:items-center lg:justify-center lg:bg-[#F6F8F7] lg:p-6">
      <div className="flex w-full flex-col lg:grid lg:max-w-5xl lg:grid-cols-[0.9fr_1.1fr] lg:overflow-hidden lg:rounded-3xl lg:bg-white lg:shadow-[0_20px_50px_rgba(9,20,19,0.08)] lg:ring-1 lg:ring-slate-100">
        {/* BRAND PANEL — tablet landscape / desktop */}
        <section className="hidden flex-col justify-between bg-[#020C08] p-10 text-white lg:flex">
          <div className="flex items-center gap-3">
            <img src={sellixMark} alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
            <span className="text-sm font-semibold tracking-[0.2em]">SELLIX</span>
          </div>

          <div className="max-w-xs">
            <p className="text-2xl font-semibold leading-snug">Run your store from one place.</p>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Sales, inventory, customers and reports — at the counter or on the go.
            </p>
          </div>

          <p className="flex items-center gap-2 text-xs text-white/50">
            <ShieldCheck size={14} className="text-emerald-400" />
            Authorized staff only
          </p>
        </section>

        {/* SIGN-IN */}
        <main className="flex flex-1 items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-[max(2.5rem,env(safe-area-inset-top,0px))] lg:px-14 lg:py-14">
          <div className="w-full max-w-sm">
            <img
              src={sellixMark}
              alt="Sellix"
              width={64}
              height={64}
              className="h-16 w-16 rounded-2xl lg:hidden"
            />

            <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-tight lg:mt-0">Welcome back</h1>
            <p className="mt-1.5 text-[15px] text-slate-500">Sign in to your Sellix store.</p>

            <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
              {formError && (
                <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {formError}
                </p>
              )}

              <TextField
                label="Email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                autoFocus={!email}
                placeholder="name@store.com"
                value={email}
                readOnly={busy}
                error={fieldErrors.email}
                onChange={(value) => {
                  setEmail(value)
                  setFieldErrors({})
                  setFormError(null)
                }}
                onKeyDown={handleEmailKeyDown}
              />

              <TextField
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                enterKeyHint="go"
                value={password}
                readOnly={busy}
                error={fieldErrors.password}
                hint={capsLockOn ? 'Caps Lock is on.' : undefined}
                onChange={(value) => {
                  setPassword(value)
                  setFieldErrors((current) => ({ email: current.email }))
                  setFormError(null)
                }}
                onKeyDown={trackCapsLock}
                onKeyUp={trackCapsLock}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] transition active:bg-[#E6F1EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                }
              />

              <PrimaryButton type="submit" disabled={busy} aria-busy={busy} className="mt-6! w-full">
                {busy ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </PrimaryButton>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Forgot your password? Ask your store admin to reset it.
            </p>

            {import.meta.env.DEV && DEMO_ACCOUNTS.length > 0 && (
              <div className="mt-8 rounded-2xl bg-[#F6F8F7] p-4">
                <p className="text-xs font-medium text-slate-500">Demo accounts · development only</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DEMO_ACCOUNTS.map((account) => {
                    const selected = email.trim().toLowerCase() === account.email
                    return (
                      <button
                        key={account.email}
                        type="button"
                        onClick={() => fillDemoAccount(account)}
                        disabled={busy}
                        aria-pressed={selected}
                        className={`h-10 rounded-full px-4 text-sm font-medium transition disabled:opacity-50 ${
                          selected ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 active:bg-slate-50'
                        }`}
                      >
                        {account.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
