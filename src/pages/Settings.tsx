import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'

import { authApi } from '../api/authApi'
import { settingsApi, type SettingsPayload } from '../api/settingsApi'
import { DesktopPage, SectionCard } from '../components/ui/DesktopKit'
import { ChevronRight } from '../components/ui/Icons'
import { Avatar, EMAIL_PATTERN, PrimaryButton, SwitchRow, TextAreaField, TextButton, TextField } from '../components/ui/MobileKit'
import { ConfirmDialog } from '../components/ui/Modal'
import { ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useIsMobile } from '../hooks/useIsMobile'
import { getErrorMessage } from '../utils/errors'
import { ROLE_LABELS, type Role } from '../utils/permissions'
import { MobileSettings } from './mobile/MobileSettings'

const MIN_PASSWORD = 8

type StoreErrors = Partial<Record<'storeName' | 'email' | 'currencySymbol' | 'taxRate', string>>

export function SettingsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileSettings />
  return <DesktopSettingsPage />
}

function toPayload(data: SettingsPayload): SettingsPayload {
  return {
    storeName: data.storeName,
    phone: data.phone,
    email: data.email,
    address: data.address,
    currency: data.currency,
    currencySymbol: data.currencySymbol,
    taxRate: data.taxRate,
    receiptFooter: data.receiptFooter,
    showLogoOnReceipt: data.showLogoOnReceipt,
  }
}

const percent = (fraction: number) => String(Math.round(fraction * 10000) / 100)

function DesktopSettingsPage() {
  const { notify } = useToast()
  const { user, logout, can } = useAuth()
  const canManageSettings = can('settings.manage')
  const { reload: reloadSettings } = useSettings()
  const navigate = useNavigate()
  const store = useAsync(() => settingsApi.get(), [])

  const [form, setForm] = useState<SettingsPayload | null>(null)
  const [saved, setSaved] = useState<SettingsPayload | null>(null)
  const [taxInput, setTaxInput] = useState('')
  const [busy, setBusy] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const passwordChangeSupported = Capacitor.isNativePlatform()

  useEffect(() => {
    if (!store.data) return
    const next = toPayload(store.data)
    setForm(next)
    setSaved(next)
    setTaxInput(percent(next.taxRate))
  }, [store.data])

  const isDirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved))

  const errors: StoreErrors = {}
  if (form) {
    if (!form.storeName.trim()) errors.storeName = 'Enter your store name. It appears on receipts.'
    if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email.'
    if (!form.currencySymbol.trim()) errors.currencySymbol = 'Required.'
    const tax = Number(taxInput)
    if (taxInput.trim() === '' || Number.isNaN(tax) || tax < 0 || tax > 100) errors.taxRate = 'Enter a rate from 0 to 100.'
  }
  const isValid = Object.keys(errors).length === 0

  const passwordError =
    newPassword.length > 0 && newPassword.length < MIN_PASSWORD
      ? `Use at least ${MIN_PASSWORD} characters.`
      : newPassword && newPassword === currentPassword
      ? 'Choose a password different from the current one.'
      : undefined

  const update = (patch: Partial<SettingsPayload>) => setForm((current) => (current ? { ...current, ...patch } : current))

  async function saveStore() {
    if (!form || !isValid || busy) return
    setBusy(true)
    try {
      await settingsApi.update({ ...form, storeName: form.storeName.trim() })
      await reloadSettings()
      setSaved(form)
      notify('Settings saved.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function discardChanges() {
    if (!saved) return
    setForm(saved)
    setTaxInput(percent(saved.taxRate))
  }

  async function changePassword() {
    if (passwordError || !currentPassword || newPassword.length < MIN_PASSWORD) return
    setPasswordBusy(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      notify('Password updated.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setPasswordBusy(false)
    }
  }

  const links = [
    can('printer.configure') && { label: 'Receipt printer', hint: 'Bluetooth printer and cash drawer', to: '/printer-settings' },
    can('users.manage') && { label: 'Users', hint: 'Staff accounts and roles', to: '/users' },
  ].filter(Boolean) as { label: string; hint: string; to: string }[]

  return (
    <DesktopPage title="Settings" subtitle="Store, receipts and your account" maxWidth="max-w-5xl">
      {store.loading && !form && (
        <div className="py-20">
          <Spinner />
        </div>
      )}
      {store.error && !form && (
        <div className="mt-6">
          <ErrorState message={store.error} onRetry={() => void store.reload()} />
        </div>
      )}

      <div className={`mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] ${isDirty ? 'pb-24' : ''}`}>
        <div className="min-w-0 space-y-6">
          {form && (
            <fieldset disabled={!canManageSettings || busy} className="min-w-0 space-y-6">
              {!canManageSettings && (
                <p className="rounded-2xl bg-white px-5 py-3 text-sm text-slate-500 ring-1 ring-slate-100">
                  Only admins can change store settings. You can still view them here.
                </p>
              )}

              <SectionCard title="Store" description="Shown at the top of every receipt.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Store name" value={form.storeName} onChange={(storeName) => update({ storeName })} error={errors.storeName} />
                  <TextField label="Phone" optional type="tel" value={form.phone ?? ''} onChange={(phone) => update({ phone })} />
                  <TextField
                    label="Email"
                    optional
                    type="email"
                    autoCapitalize="none"
                    value={form.email ?? ''}
                    onChange={(email) => update({ email })}
                    error={errors.email}
                  />
                  <TextAreaField label="Address" optional rows={2} value={form.address ?? ''} onChange={(address) => update({ address })} />
                </div>
              </SectionCard>

              <SectionCard title="Currency & tax">
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField
                    label="Currency code"
                    value={form.currency}
                    onChange={(currency) => update({ currency: currency.toUpperCase() })}
                    placeholder="PHP"
                    maxLength={3}
                  />
                  <TextField
                    label="Symbol"
                    value={form.currencySymbol}
                    onChange={(currencySymbol) => update({ currencySymbol })}
                    error={errors.currencySymbol}
                    placeholder="₱"
                    maxLength={3}
                  />
                  <TextField
                    label="Tax rate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    value={taxInput}
                    onChange={(value) => {
                      setTaxInput(value)
                      const tax = Number(value)
                      if (value.trim() !== '' && !Number.isNaN(tax)) update({ taxRate: tax / 100 })
                    }}
                    error={errors.taxRate}
                    trailing={<span className="px-3 text-sm text-slate-400">%</span>}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">Tax is added to every sale. Use 0 if your prices already include tax.</p>
              </SectionCard>

              <SectionCard title="Receipt">
                <div className="space-y-4">
                  <TextAreaField
                    label="Footer message"
                    optional
                    rows={2}
                    value={form.receiptFooter}
                    onChange={(receiptFooter) => update({ receiptFooter })}
                    placeholder="e.g. Thank you, come again!"
                  />
                  <SwitchRow
                    label="Show logo"
                    description="Print your store initial at the top"
                    checked={form.showLogoOnReceipt}
                    onChange={(showLogoOnReceipt) => update({ showLogoOnReceipt })}
                    disabled={!canManageSettings}
                  />
                </div>
              </SectionCard>
            </fieldset>
          )}

          <SectionCard
            title="Password"
            description={passwordChangeSupported ? 'Change the password you use to sign in.' : 'Password changes are only available in the Android app.'}
          >
            <fieldset disabled={!passwordChangeSupported || passwordBusy} className="min-w-0">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Current password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                />
                <TextField
                  label="New password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={setNewPassword}
                  error={passwordError}
                  hint={`At least ${MIN_PASSWORD} characters.`}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPasswords((visible) => !visible)}
                      className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#E6F1EA]"
                    >
                      {showPasswords ? 'Hide' : 'Show'}
                    </button>
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={!currentPassword || newPassword.length < MIN_PASSWORD || Boolean(passwordError)}
                className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium transition hover:bg-[#E9EEEB] disabled:text-slate-400"
              >
                {passwordBusy ? 'Updating…' : 'Update password'}
              </button>
            </fieldset>
          </SectionCard>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-100">
            <div className="flex items-center gap-3">
              <Avatar name={user?.fullName ?? '?'} large />
              <div className="min-w-0">
                <p className="truncate font-semibold">{user?.fullName}</p>
                <p className="truncate text-sm text-slate-500">{user?.email}</p>
                {user?.role && <p className="text-xs text-[#1F5E3B]">{ROLE_LABELS[user.role as Role] ?? user.role}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="mt-4 h-11 w-full rounded-full text-sm font-medium text-rose-600 ring-1 ring-rose-100 hover:bg-rose-50"
            >
              Log out
            </button>
          </section>

          {form && (
            <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-100">
              <h2 className="text-sm font-semibold">Receipt preview</h2>
              <div className="mt-3 rounded-xl bg-[#F6F8F7] p-4 font-mono text-xs text-slate-700">
                {form.showLogoOnReceipt && (
                  <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#091413] font-sans text-sm font-bold text-white">
                    {form.storeName.trim().slice(0, 1).toUpperCase() || 'S'}
                  </div>
                )}
                <p className="text-center text-sm font-bold text-[#091413]">{form.storeName || 'Store name'}</p>
                {[form.address, form.phone, form.email].filter(Boolean).map((line) => (
                  <p key={line} className="text-center text-[11px] text-slate-500">
                    {line}
                  </p>
                ))}
                <div className="my-2 border-t border-dashed border-slate-300" />
                <PreviewLine label="Item A × 2" value={`${form.currencySymbol}150.00`} />
                <PreviewLine label="Item B" value={`${form.currencySymbol}95.00`} />
                <div className="my-2 border-t border-dashed border-slate-300" />
                <PreviewLine label="Total" value={`${form.currencySymbol}245.00`} />
                {form.receiptFooter && <p className="mt-2 text-center text-[11px] text-slate-500">{form.receiptFooter}</p>}
              </div>
            </section>
          )}

          {links.length > 0 && (
            <nav aria-label="More settings" className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
              {links.map((link) => (
                <button
                  key={link.to}
                  type="button"
                  onClick={() => navigate(link.to)}
                  className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-5 py-3 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{link.label}</span>
                    <span className="block text-xs text-slate-400">{link.hint}</span>
                  </span>
                  <ChevronRight size={12} className="text-slate-300" />
                </button>
              ))}
            </nav>
          )}
        </aside>
      </div>

      {/* SAVE BAR — only when there is something to save */}
      {isDirty && canManageSettings && (
        <div className="fixed inset-x-0 bottom-6 z-40 px-6">
          <div className="mx-auto flex max-w-lg items-center gap-2 rounded-2xl bg-white p-2 shadow-[0_8px_30px_rgba(9,20,19,0.15)] ring-1 ring-slate-100">
            <span className="px-3 text-sm text-slate-500">Unsaved changes</span>
            <div className="flex-1" />
            <TextButton onClick={discardChanges} disabled={busy} className="h-11">
              Discard
            </TextButton>
            <PrimaryButton onClick={() => void saveStore()} disabled={busy || !isValid} className="h-11 flex-none px-6">
              {busy ? 'Saving…' : isValid ? 'Save changes' : 'Fix errors to save'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {confirmLogout && (
        <ConfirmDialog
          title="Log out?"
          message={isDirty ? 'You have unsaved settings changes that will be lost.' : 'You’ll need your email and password to sign back in.'}
          confirmLabel="Log out"
          danger
          busy={loggingOut}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setLoggingOut(true)
            void logout().finally(() => {
              setLoggingOut(false)
              setConfirmLogout(false)
            })
          }}
        />
      )}
    </DesktopPage>
  )
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

export default SettingsPage
