import { useState } from 'react'

import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../utils/errors'

/** "Generate" inside a SKU / barcode field: fills in the next free code so staff don't have to invent one. */
export function GenerateCodeButton({
  label,
  onGenerate,
  onCode,
}: {
  label: string
  onGenerate: () => Promise<string>
  onCode: (code: string) => void
}) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          onCode(await onGenerate())
        } catch (err) {
          notify(getErrorMessage(err), 'error')
        } finally {
          setBusy(false)
        }
      }}
      className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#E6F1EA] disabled:opacity-50 pointer-coarse:h-11"
    >
      {busy ? '…' : 'Generate'}
    </button>
  )
}
