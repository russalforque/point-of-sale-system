import { useRef, useState, type ReactNode } from 'react'

import { authApi, type Approver } from '../../api/authApi'
import { useAuth } from '../../context/AuthContext'
import { getErrorMessage } from '../../utils/errors'
import type { Permission } from '../../utils/permissions'
import { ConfirmDialog, Modal } from '../ui/Modal'

type Request = {
  permission: Permission
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (approver: Approver | null) => void
}

/**
 * Gate for sensitive actions (voids, refunds…). Someone whose role allows the action just
 * confirms it; anyone else needs a manager or admin to enter their PIN on the spot.
 *
 *   const approval = useApproval()
 *   const approver = await approval.request({ permission: 'sales.void', ... })
 *   if (!approver) return            // cancelled
 *   ...render {approval.dialog}
 */
export function useApproval() {
  const { user, can } = useAuth()
  const [request, setRequest] = useState<Request | null>(null)

  function ask(options: Omit<Request, 'resolve' | 'danger'> & { danger?: boolean }): Promise<Approver | null> {
    return new Promise((resolve) => setRequest({ danger: false, ...options, resolve }))
  }

  function finish(approver: Approver | null) {
    request?.resolve(approver)
    setRequest(null)
  }

  const selfApproves = request ? can(request.permission) : false

  const dialog: ReactNode = !request ? null : selfApproves && user ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      danger={request.danger}
      onCancel={() => finish(null)}
      onConfirm={() => finish({ id: Number(user.id), fullName: user.fullName, role: user.role })}
    />
  ) : (
    <PinDialog request={request} onDone={finish} />
  )

  return { request: ask, dialog }
}

function PinDialog({ request, onDone }: { request: Request; onDone: (approver: Approver | null) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const approver = await authApi.verifyApproval(pin, request.permission)
      onDone(approver)
    } catch (err) {
      setError(getErrorMessage(err))
      setPin('')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Manager approval needed"
      description={request.title}
      onClose={() => onDone(null)}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full gap-2">
          <button
            type="button"
            onClick={() => onDone(null)}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 disabled:opacity-40 sm:flex-none sm:px-5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || pin.length < 4}
            className={`h-12 flex-1 rounded-2xl px-6 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 ${
              request.danger ? 'bg-rose-600' : 'bg-[#1F5E3B]'
            }`}
          >
            {busy ? 'Checking…' : request.confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{request.message}</p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="approval-pin" className="block text-sm font-medium">
          Manager or admin PIN
        </label>
        <input
          ref={inputRef}
          id="approval-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
            setError(null)
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'approval-pin-error' : undefined}
          className={`mt-1.5 h-14 w-full rounded-2xl border-0 px-4 text-center text-2xl tracking-[0.5em] outline-none transition focus:bg-white focus:ring-2 ${
            error ? 'bg-rose-50 ring-2 ring-rose-300 focus:ring-rose-500' : 'bg-[#F3F5F4] focus:ring-[#1F5E3B]'
          }`}
        />
        {error && (
          <p id="approval-pin-error" role="alert" className="mt-2 text-sm text-rose-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
