import { useEffect, useState } from 'react'
import { authApi } from '../api/authApi'
import { settingsApi, type SettingsPayload } from '../api/settingsApi'
import { Button } from '../components/ui/Button'
import { Field, Input, Textarea } from '../components/ui/Field'
import { Card, PageHeader } from '../components/ui/Page'
import { ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { getErrorMessage } from '../utils/errors'

export function SettingsPage() {
  const { notify } = useToast()
  const { user } = useAuth()
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
    <div>
      <PageHeader title="Settings" subtitle="Store profile, tax, receipts, and account" />
      {store.loading ? <Spinner /> : null}
      {store.error ? <ErrorState message={store.error} onRetry={() => void store.reload()} /> : null}
      {form ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-semibold">Store information</h2>
            <div className="space-y-3">
              <Field label="Store name">
                <Input value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Address">
                <Textarea value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency">
                  <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
                </Field>
                <Field label="Symbol">
                  <Input value={form.currencySymbol} onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })} />
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
              <Field label="Receipt footer">
                <Textarea value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showLogoOnReceipt}
                  onChange={(e) => setForm({ ...form, showLogoOnReceipt: e.target.checked })}
                />
                Show logo on receipt
              </label>
              <Button onClick={() => void saveStore()} disabled={busy || !form.storeName.trim()}>
                {busy ? 'Saving…' : 'Save store settings'}
              </Button>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-semibold">Receipt preview</h2>
            <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <div className="mb-3 flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                  {form.storeName.trim().slice(0, 1).toUpperCase() || 'S'}
                </div>
              </div>
              <p className="text-center text-lg font-bold text-gray-900">{form.storeName || 'Store name'}</p>
              {(form.address || form.phone || form.email) && (
                <div className="mt-2 space-y-0.5 text-center text-[11px] text-gray-500">
                  {form.address && <p>{form.address}</p>}
                  {form.phone && <p>{form.phone}</p>}
                  {form.email && <p>{form.email}</p>}
                </div>
              )}
              <div className="my-3 border-t border-gray-200" />
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span>Item A</span><span>₱150.00</span></div>
                <div className="flex justify-between"><span>Item B</span><span>₱95.00</span></div>
              </div>
              <div className="my-3 border-t border-gray-200" />
              <div className="flex justify-between text-xs font-medium"><span>Total</span><span>₱245.00</span></div>
              {form.receiptFooter && <p className="mt-3 text-center text-[11px] text-gray-500">{form.receiptFooter}</p>}
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-semibold">Account</h2>
            <p className="mb-4 text-sm text-gray-600">
              Signed in as <span className="font-medium text-gray-900">{user?.fullName}</span> ({user?.email})
            </p>
            <div className="space-y-3">
              <Field label="Current password">
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </Field>
              <Field label="New password">
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                onClick={() => void changePassword()}
                disabled={busy || !currentPassword || newPassword.length < 8}
              >
                Update password
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
