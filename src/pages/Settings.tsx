import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'
import { authApi } from '../api/authApi'
import { settingsApi, type SettingsPayload } from '../api/settingsApi'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Field, Input, Textarea } from '../components/ui/Field'
import { FormSection } from '../components/ui/FormSection'
import { ConfirmDialog } from '../components/ui/Modal'
import { Card, PageHeader } from '../components/ui/Page'
import { ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useIsMobile } from '../hooks/useIsMobile'
import { getErrorMessage } from '../utils/errors'
import { MobileSettings } from './mobile/MobileSettings'

export function SettingsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileSettings />
  return <DesktopSettingsPage />
}

function DesktopSettingsPage() {
  const { notify } = useToast()
  const { user, logout, can } = useAuth()
  const canManageSettings = can('settings.manage')
  const { reload: reloadSettings } = useSettings()
  const store = useAsync(() => settingsApi.get(), [])
  const [form, setForm] = useState<SettingsPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    if (store.data) {
      setForm({
        storeName: store.data.storeName,
        phone: store.data.phone,
        email: store.data.email,
        address: store.data.address,
        currency: store.data.currency,
        currencySymbol: store.data.currencySymbol,
        taxRate: store.data.taxRate,
        receiptFooter: store.data.receiptFooter,
        showLogoOnReceipt: store.data.showLogoOnReceipt,
      })
    }
  }, [store.data])

  async function saveStore() {
    if (!form) return
    setBusy(true)
    try {
      await settingsApi.update(form)
      await reloadSettings()
      await store.reload()
      notify('Store settings saved.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    setBusy(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      notify('Password updated.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const initials =
    user?.fullName
      ?.split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-16 antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-7xl px-3.5 pt-4 pb-10 sm:px-6 sm:pt-6 md:px-8">
        <PageHeader title="Settings" subtitle="Store profile, tax, receipts, and account" />

        {store.loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Spinner />
            <p className="mt-3 text-xs font-semibold text-slate-400">Loading settings…</p>
          </div>
        )}

        {store.error && (
          <div className="mt-2">
            <ErrorState message={store.error} onRetry={() => void store.reload()} />
          </div>
        )}

        {form ? (
          <div className="mt-2 grid gap-4 xl:grid-cols-2">
            {/* =====================================================
                STORE INFORMATION
            ====================================================== */}
            <Card className="p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Store Information</h2>
                {!canManageSettings && <Badge tone="amber">Read-only</Badge>}
              </div>
              <fieldset disabled={!canManageSettings} className="space-y-5 text-xs disabled:opacity-60">
                <FormSection title="Basic Information">
                  <Field label="Store name" required>
                    <Input
                      value={form.storeName}
                      onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                      required
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <Field label="Phone">
                      <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field label="Email">
                      <Input
                        type="email"
                        value={form.email ?? ''}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Address">
                    <Textarea value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  </Field>
                </FormSection>

                <FormSection title="Tax & Currency">
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <Field label="Currency">
                      <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
                    </Field>
                    <Field label="Symbol">
                      <Input
                        value={form.currencySymbol}
                        onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Tax rate (%)">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={Math.round(form.taxRate * 10000) / 100}
                      onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) / 100 })}
                    />
                  </Field>
                </FormSection>

                <FormSection title="Receipt">
                  <Field label="Receipt footer">
                    <Textarea
                      value={form.receiptFooter}
                      onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                    />
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#091413]/80">
                    <input
                      type="checkbox"
                      checked={form.showLogoOnReceipt}
                      onChange={(e) => setForm({ ...form, showLogoOnReceipt: e.target.checked })}
                      className="h-4 w-4 rounded border-[#091413]/20 text-[#285A48] focus:ring-[#285A48]"
                    />
                    Show logo on receipt
                  </label>
                </FormSection>

                {canManageSettings && (
                  <Button onClick={() => void saveStore()} disabled={busy || !form.storeName.trim()} className="w-full sm:w-auto">
                    {busy ? 'Saving…' : 'Save store settings'}
                  </Button>
                )}
              </fieldset>
            </Card>

            {/* =====================================================
                RECEIPT PREVIEW
            ====================================================== */}
            <Card className="p-4 sm:p-5">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Receipt Preview</h2>
              <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-4 text-sm text-slate-700">
                <div className="mb-3 flex items-center justify-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                    {form.storeName.trim().slice(0, 1).toUpperCase() || 'S'}
                  </div>
                </div>
                <p className="text-center text-lg font-bold text-[#091413]">{form.storeName || 'Store name'}</p>
                {(form.address || form.phone || form.email) && (
                  <div className="mt-2 space-y-0.5 text-center text-[11px] text-slate-400">
                    {form.address && <p>{form.address}</p>}
                    {form.phone && <p>{form.phone}</p>}
                    {form.email && <p>{form.email}</p>}
                  </div>
                )}
                <div className="my-3 border-t border-[#E5EBE7]" />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>Item A</span>
                    <span>₱150.00</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Item B</span>
                    <span>₱95.00</span>
                  </div>
                </div>
                <div className="my-3 border-t border-[#E5EBE7]" />
                <div className="flex justify-between text-xs font-bold text-[#091413]">
                  <span>Total</span>
                  <span>₱245.00</span>
                </div>
                {form.receiptFooter && (
                  <p className="mt-3 text-center text-[11px] text-slate-400">{form.receiptFooter}</p>
                )}
              </div>
            </Card>

            {/* =====================================================
                ACCOUNT
            ====================================================== */}
            <Card className="p-4 sm:p-5 xl:col-span-2">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Account</h2>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3 sm:min-w-72">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#091413]">{user?.fullName || 'Admin'}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(true)}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
                  >
                    <FontAwesomeIcon icon={faRightFromBracket} className="h-3.5 w-3.5" />
                    <span>Log out</span>
                  </button>
                </div>

                <div className="w-full space-y-3 sm:max-w-sm">
                  <Field label="Current password" required>
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="New password" required hint="Minimum 8 characters">
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    onClick={() => void changePassword()}
                    disabled={busy || !currentPassword || newPassword.length < 8}
                    className="w-full sm:w-auto"
                  >
                    Update password
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}
      </div>

      {showLogoutConfirm && (
        <ConfirmDialog
          title="Log out?"
          message="Are you sure you want to log out?"
          confirmLabel="Log out"
          danger
          busy={loggingOut}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            setLoggingOut(true)
            void logout().finally(() => {
              setLoggingOut(false)
              setShowLogoutConfirm(false)
            })
          }}
        />
      )}
    </div>
  )
}
