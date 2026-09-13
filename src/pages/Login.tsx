import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Store } from '../components/ui/Icons'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Field'
import { getErrorMessage } from '../utils/errors'
import heroImage from '../assets/hero.png'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@sellix.local')
  const [password, setPassword] = useState('Admin123!')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-[#f4f5f7] p-3 sm:p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[0.95fr_1.05fr] lg:min-h-[calc(100vh-4rem)]">
        <section className="relative hidden overflow-hidden bg-[#111827] p-8 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:34px_34px]" />
          <div className="absolute -bottom-20 -right-12 h-72 w-72 rounded-full border-[28px] border-violet-500/20" />

          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-900 shadow-lg shadow-black/20">
                <Store size={20} />
              </div>
              <span className="text-xs font-bold tracking-[0.24em] text-white/90">SELLIX</span>
            </div>

            <div className="mt-20 max-w-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Point of sale, simplified</p>
              <h2 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white">Move the store forward.</h2>
              <p className="mt-5 max-w-xs text-sm leading-6 text-slate-300">A clear view of inventory, customers, and every sale in one calm workspace.</p>
            </div>
          </div>

          <div className="relative flex items-end justify-between gap-6">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <ShieldCheck size={16} className="text-emerald-300" />
              <span>Secure workspace access</span>
            </div>
            <img src={heroImage} alt="Sellix platform mark" className="h-28 w-28 object-contain opacity-90" />
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-12 lg:px-16">
          <form onSubmit={onSubmit} className="w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <Store size={20} />
                </div>
                <span className="text-xs font-bold tracking-[0.24em] text-slate-900">SELLIX</span>
              </div>
            </div>

            <div className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Welcome back</p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Sign in to Sellix</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">Enter your workspace credentials to continue managing your store.</p>
            </div>

            <div className="space-y-5">
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" className="mt-1 min-h-11 rounded-lg border-slate-200 bg-slate-50 px-3.5 focus:border-slate-400 focus:ring-2 focus:ring-slate-200" />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="mt-1 min-h-11 rounded-lg border-slate-200 bg-slate-50 px-3.5 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </Field>
            </div>

            {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}
            <Button type="submit" className="mt-7 min-h-12 w-full" disabled={busy}>
              <span>{busy ? 'Signing in…' : 'Sign in'}</span>
              {!busy ? <ArrowRight size={17} /> : null}
            </Button>
            <p className="mt-6 text-center text-xs text-slate-400">Authorized team members only</p>
          </form>
        </section>
      </div>
    </div>
  )
}
