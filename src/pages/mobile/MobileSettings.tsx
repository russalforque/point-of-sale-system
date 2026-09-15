import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'

import { authApi } from '../../api/authApi'
import { settingsApi, type SettingsPayload } from '../../api/settingsApi'
import { ChevronRight } from '../../components/ui/Icons'
import {
  ABOVE_BOTTOM_NAV,
  Avatar,
  EMAIL_PATTERN,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PrimaryButton,
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
} from '../../components/ui/MobileKit'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { ROLE_LABELS, type Role } from '../../utils/permissions'

const MIN_PASSWORD = 8
const SAMPLE_SUBTOTAL = 245

type StoreErrors = Partial<Record<'storeName' | 'email' | 'currency' | 'currencySymbol' | 'taxRate', string>>

const toPercentText = (rate: number) => String(Math.round(rate * 10000) / 100)

export function MobileSettings() {
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
  const storeFieldsRef = useRef<HTMLFieldSetElement | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const passwordChangeSupported = Capacitor.isNativePlatform()

  function loadForm(data: SettingsPayload) {
    const next: SettingsPayload = {
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
    setForm(next)
    setSaved(next)
    setTaxInput(toPercentText(data.taxRate))
  }

  useEffect(() => {
    if (store.data) loadForm(store.data)
  }, [store.data])

  const changedCount =
    form && saved
      ? (Object.keys(form) as (keyof SettingsPayload)[]).filter((key) => (form[key] ?? '') !== (saved[key] ?? '')).length
      : 0
  const isDirty = changedCount > 0

  const errors: StoreErrors = {}
  if (form) {
    if (!form.storeName.trim()) errors.storeName = 'Enter your store name. It appears on receipts.'
    if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email, e.g. shop@example.com.'
    if (!/^[A-Z]{3}$/.test(form.currency.trim())) errors.currency = 'Use 3 letters, e.g. PHP.'
    if (!form.currencySymbol.trim()) errors.currencySymbol = 'Enter a symbol, e.g. ₱.'
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
  const confirmError = confirmPassword && confirmPassword !== newPassword ? 'Passwords don’t match.' : undefined
  const canSubmitPassword =
    Boolean(currentPassword) && newPassword.length >= MIN_PASSWORD && !passwordError && confirmPassword === newPassword

  /** Bring the first invalid store field into view so the user knows what blocks saving. */
  function focusFirstError() {
    const field = storeFieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (!field) return
    field.scrollIntoView({ block: 'center', behavior: 'smooth' })
    field.focus({ preventScroll: true })
  }

  async function saveStore() {
    if (!form || busy) return
    if (!isValid) {
      focusFirstError()
      return
    }
    setBusy(true)
    try {
      const payload = { ...form, storeName: form.storeName.trim(), currency: form.currency.trim() }
      await settingsApi.update(payload)
      await reloadSettings()
      setForm(payload)
      setSaved(payload)
      notify('Settings saved.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function discardChanges() {
    if (saved) {
      setForm(saved)
      setTaxInput(toPercentText(saved.taxRate))
    }
  }

  async function changePassword() {
    if (!canSubmitPassword || passwordBusy) return
    setPasswordBusy(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswords(false)
      notify('Password updated.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setPasswordBusy(false)
    }
  }

  const update = (patch: Partial<SettingsPayload>) => setForm((current) => (current ? { ...current, ...patch } : current))

  const links = [
    can('printer.configure') && { label: 'Receipt printer', hint: 'Bluetooth printer and cash drawer', to: '/printer-settings' },
    can('users.manage') && { label: 'Users', hint: 'Staff accounts and roles', to: '/users' },
  ].filter(Boolean) as { label: string; hint: string; to: string }[]

  // Live examples use the values being edited, so the effect of a change is visible before saving.
  const symbol = form?.currencySymbol.trim() || '₱'
  const previewRate = errors.taxRate ? 0 : Number(taxInput) / 100
  const sampleTax = SAMPLE_SUBTOTAL * previewRate
  const money = (value: number) => formatMoney(value, symbol)

  return (
    <div className={`flex min-h-full flex-col bg-white text-[#091413] antialiased ${isDirty ? 'pb-24' : ''}`}>
      <PageHeader title="Settings" subtitle="Store, receipts and your account" />

      <main className="flex-1 px-5 pb-8">
        {/* ACCOUNT */}
        <section aria-label="Your account" className="flex items-center gap-3 rounded-3xl bg-[#F2F8F4] p-4">
          <Avatar name={user?.fullName ?? '?'} large />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{user?.fullName}</p>
            <p className="truncate text-sm text-slate-500">{user?.email}</p>
          </div>
          {user?.role && (
            <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#1F5E3B]">
              {ROLE_LABELS[user.role as Role] ?? user.role}
            </span>
          )}
        </section>

        {links.length > 0 && (
          <ul className="mt-3 overflow-hidden rounded-2xl ring-1 ring-slate-100">
            {links.map((link) => (
              <li key={link.to} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => navigate(link.to)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{link.label}</span>
                    <span className="block truncate text-xs text-slate-500">{link.hint}</span>
                  </span>
                  <ChevronRight size={12} className="text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {store.loading && !form && <LoadingBlock />}
        {store.error && !form && <ErrorBlock message={store.error} onRetry={() => void store.reload()} />}

        {form && (
          <fieldset ref={storeFieldsRef} disabled={!canManageSettings || busy} className="min-w-0">
            {!canManageSettings && (
              <p className="mt-6 rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">
                You can view store settings. Only admins can change them.
              </p>
            )}

            <Group title="Store" description="Shown at the top of every receipt.">
              <TextField
                label="Store name"
                value={form.storeName}
                onChange={(storeName) => update({ storeName })}
                error={errors.storeName}
                autoComplete="organization"
                autoCapitalize="words"
              />
              <TextField
                label="Phone"
                optional
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone ?? ''}
                onChange={(phone) => update({ phone })}
              />
              <TextField
                label="Email"
                optional
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
                value={form.email ?? ''}
                onChange={(email) => update({ email })}
                error={errors.email}
              />
              <TextAreaField label="Address" optional value={form.address ?? ''} onChange={(address) => update({ address })} />
            </Group>

            <Group title="Currency & tax">
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Symbol"
                  value={form.currencySymbol}
                  onChange={(currencySymbol) => update({ currencySymbol })}
                  error={errors.currencySymbol}
                  placeholder="₱"
                  maxLength={3}
                />
                <TextField
                  label="Code"
                  value={form.currency}
                  onChange={(currency) => update({ currency: currency.toUpperCase().replace(/[^A-Z]/g, '') })}
                  error={errors.currency}
                  placeholder="PHP"
                  maxLength={3}
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
              </div>
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
                hint={
                  previewRate > 0
                    ? `Added to each sale: a ${money(100)} sale totals ${money(100 * (1 + previewRate))}.`
                    : 'No tax is added. Use 0 if your prices already include tax.'
                }
                trailing={<span className="px-3 text-[15px] text-slate-400">%</span>}
              />
            </Group>

            <Group title="Receipt">
              <TextAreaField
                label="Footer message"
                optional
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

              {/* Preview stays open so changes are visible as you type */}
              <div>
                <p className="text-sm font-medium">Preview</p>
                <div className="mt-1.5 rounded-2xl bg-[#F6F8F7] p-4">
                  <div className="mx-auto max-w-72 rounded-lg bg-white px-4 py-4 font-mono text-xs text-slate-700 shadow-[0_1px_3px_rgba(9,20,19,0.08)]">
                    {form.showLogoOnReceipt && (
                      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#091413] font-sans text-sm font-bold text-white">
                        {form.storeName.trim().slice(0, 1).toUpperCase() || 'S'}
                      </div>
                    )}
                    <p className="text-center text-sm font-bold text-[#091413]">{form.storeName.trim() || 'Store name'}</p>
                    {[form.address, form.phone, form.email]
                      .map((line) => line?.trim())
                      .filter(Boolean)
                      .map((line) => (
                        <p key={line} className="wrap-break-word text-center text-[11px] text-slate-500">
                          {line}
                        </p>
                      ))}
                    <div className="my-2 border-t border-dashed border-slate-300" />
                    <ReceiptLine label="Item A × 2" value={money(150)} />
                    <ReceiptLine label="Item B" value={money(95)} />
                    <div className="my-2 border-t border-dashed border-slate-300" />
                    {previewRate > 0 && (
                      <>
                        <ReceiptLine label="Subtotal" value={money(SAMPLE_SUBTOTAL)} />
                        <ReceiptLine label={`Tax ${taxInput}%`} value={money(sampleTax)} />
                      </>
                    )}
                    <ReceiptLine label="Total" value={money(SAMPLE_SUBTOTAL + sampleTax)} bold />
                    {form.receiptFooter.trim() && (
                      <p className="mt-3 wrap-break-word text-center text-[11px] text-slate-500">{form.receiptFooter}</p>
                    )}
                  </div>
                </div>
              </div>
            </Group>
          </fieldset>
        )}

        {/* SECURITY */}
        <Group title="Password">
          {!passwordChangeSupported ? (
            <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">
              Password changes are only available in the Android app.
            </p>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                void changePassword()
              }}
            >
              <fieldset disabled={passwordBusy} className="min-w-0 space-y-4">
                <TextField
                  label="Current password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPasswords((v) => !v)}
                      aria-pressed={showPasswords}
                      className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#E6F1EA]"
                    >
                      {showPasswords ? 'Hide' : 'Show'}
                    </button>
                  }
                />
                <TextField
                  label="New password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={setNewPassword}
                  error={passwordError}
                  hint={`At least ${MIN_PASSWORD} characters.`}
                />
                <TextField
                  label="Confirm new password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={confirmError}
                />
                <button
                  type="submit"
                  disabled={!canSubmitPassword}
                  className="h-12 w-full rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-[#F3F5F4] disabled:font-medium disabled:text-slate-400"
                >
                  {passwordBusy ? 'Updating…' : 'Update password'}
                </button>
              </fieldset>
            </form>
          )}
        </Group>

        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          className="mt-10 h-12 w-full rounded-2xl text-[15px] font-medium text-rose-600 ring-1 ring-rose-100 active:bg-rose-50"
        >
          Log out
        </button>
      </main>

      {/* SAVE BAR — only appears when there is something to save */}
      {isDirty && canManageSettings && (
        <div className="fixed inset-x-0 z-40 px-4 pb-3" style={{ bottom: ABOVE_BOTTOM_NAV }}>
          <div
            role="region"
            aria-label="Unsaved changes"
            className="mx-auto flex max-w-lg items-center gap-2 rounded-2xl bg-white p-2 pl-4 shadow-[0_8px_30px_rgba(9,20,19,0.15)] ring-1 ring-slate-100"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-slate-500" aria-live="polite">
              {isValid ? `${changedCount} unsaved ${changedCount === 1 ? 'change' : 'changes'}` : <span className="text-rose-600">Fix highlighted fields</span>}
            </p>
            <TextButton onClick={discardChanges} disabled={busy} className="h-12">
              Discard
            </TextButton>
            <PrimaryButton onClick={() => void saveStore()} disabled={busy} className="h-12 flex-none px-6">
              {busy ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {confirmLogout && (
        <ConfirmDialog
          title="Log out?"
          message={
            isDirty ? 'You have unsaved settings changes that will be lost.' : 'You’ll need your email and password to sign back in.'
          }
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
    </div>
  )
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

function ReceiptLine({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'mt-1 text-[13px] font-bold text-[#091413]' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export default MobileSettings
