import { useEffect, useState } from 'react'
import { authApi } from '../../api/authApi'
import { settingsApi, type SettingsPayload } from '../../api/settingsApi'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { MobileError, MobileLoading } from '../../components/ui/MobileStates'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { getErrorMessage } from '../../utils/errors'

export function MobileSettings() {
  const { notify } = useToast()
  const { user, logout, can } = useAuth()
  const canManageSettings = can('settings.manage')
  const { reload: reloadSettings } = useSettings()
  const store = useAsync(() => settingsApi.get(), [])
  const [form, setForm] = useState<SettingsPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

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

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="pb-3">
          <h1 className="text-2xl font-black tracking-tight text-[#091413]">Settings</h1>
          <p className="mt-0.5 text-xs text-slate-500">Store profile, tax, receipts &amp; account</p>
        </header>

        {store.loading && <MobileLoading label="Loading settings…" />}

        {store.error && <MobileError message={store.error} onRetry={() => void store.reload()} />}

        {form && (
          <div className="space-y-4">
            {/* Account card */}
            <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                  {(user?.fullName || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#091413]">{user?.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-sm font-bold text-rose-600 active:scale-95 touch-manipulation"
              >
                Log out
              </button>
            </section>

            {/* Store info */}
            <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Store information</h2>
                {!canManageSettings && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">Read-only</span>
                )}
              </div>
              <fieldset disabled={!canManageSettings} className="space-y-3.5 text-sm disabled:opacity-70">
                <Field label="Store name *">
                  <Input
                    value={form.storeName}
                    onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={form.phone ?? ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="Address">
                  <Textarea
                    value={form.address ?? ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="min-h-20 rounded-2xl text-sm"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Currency">
                    <Input
                      value={form.currency}
                      onChange={(e) => setForm({ ...form, currency: e.target.value })}
                      className="min-h-12 rounded-2xl text-sm"
                    />
                  </Field>
                  <Field label="Symbol">
                    <Input
                      value={form.currencySymbol}
                      onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
                      className="min-h-12 rounded-2xl text-sm"
                    />
                  </Field>
                </div>
                <Field label="Tax rate (%)">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    value={Math.round(form.taxRate * 10000) / 100}
                    onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) / 100 })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="Receipt footer">
                  <Textarea
                    value={form.receiptFooter}
                    onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                    className="min-h-20 rounded-2xl text-sm"
                  />
                </Field>
                <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] px-3.5 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.showLogoOnReceipt}
                    onChange={(e) => setForm({ ...form, showLogoOnReceipt: e.target.checked })}
                    className="h-5 w-5 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
                  />
                  Show logo on receipt
                </label>
                {canManageSettings && (
                  <Button onClick={() => void saveStore()} disabled={busy || !form.storeName.trim()} className="min-h-12 w-full text-sm">
                    {busy ? 'Saving…' : 'Save store settings'}
                  </Button>
                )}
              </fieldset>
            </section>

            {/* Receipt preview */}
            <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Receipt preview</h2>
              <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-4 text-sm text-slate-700">
                <div className="mb-3 flex items-center justify-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#091413] text-sm font-bold text-white">
                    {form.storeName.trim().slice(0, 1).toUpperCase() || 'S'}
                  </div>
                </div>
                <p className="text-center text-base font-bold text-[#091413]">{form.storeName || 'Store name'}</p>
                {(form.address || form.phone || form.email) && (
                  <div className="mt-2 space-y-0.5 text-center text-[11px] text-slate-500">
                    {form.address && <p>{form.address}</p>}
                    {form.phone && <p>{form.phone}</p>}
                    {form.email && <p>{form.email}</p>}
                  </div>
                )}
                <div className="my-3 border-t border-slate-200" />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>Item A</span><span>₱150.00</span></div>
                  <div className="flex justify-between"><span>Item B</span><span>₱95.00</span></div>
                </div>
                <div className="my-3 border-t border-slate-200" />
                <div className="flex justify-between text-xs font-medium"><span>Total</span><span>₱245.00</span></div>
                {form.receiptFooter && <p className="mt-3 text-center text-[11px] text-slate-500">{form.receiptFooter}</p>}
              </div>
            </section>

            {/* Change password */}
            <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Change password</h2>
              <div className="space-y-3.5 text-sm">
                <Field label="Current password">
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="New password">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={() => void changePassword()}
                  disabled={busy || !currentPassword || newPassword.length < 8}
                  className="min-h-12 w-full text-sm"
                >
                  Update password
                </Button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default MobileSettings
