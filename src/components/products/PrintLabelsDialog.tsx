import { useMemo, useState } from 'react'

import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { buildProductLabels, ensurePrinterConnected, getPrinterService, printerErrorMessage } from '../../services/printer'
import type { Product } from '../../types'
import { getPrinterConfig } from '../../utils/printerConfig'
import { Modal } from '../ui/Modal'
import { QuantityStepper } from '../ui/WorkPage'

/** Prints price labels (name, price, barcode) for one product on the receipt printer. */
export function PrintLabelsDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { settings } = useSettings()
  const { notify } = useToast()
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState(false)
  const config = getPrinterConfig()

  const label = { name: product.name, price: product.sellingPrice, code: product.barcode ?? '', sku: product.sku, unit: product.unit }
  const preview = useMemo(
    () => buildProductLabels([{ label, copies: 1 }], settings, config.paperWidth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product, settings, config.paperWidth],
  )

  async function print() {
    if (busy) return
    setBusy(true)
    try {
      await ensurePrinterConnected()
      await getPrinterService().printLabels([{ label, copies }], settings, getPrinterConfig())
      notify(`${copies} ${copies === 1 ? 'label' : 'labels'} sent to the printer.`)
      onClose()
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Print price labels"
      description={product.name}
      onClose={onClose}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void print()}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Printing…' : `Print ${copies}`}
          </button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Copies</span>
        <QuantityStepper label="Number of labels" value={copies} min={1} max={100} onChange={setCopies} />
      </div>
      {!product.barcode && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This product has no barcode, so the SKU is printed as a Code 128 barcode. Add or generate a barcode on the product for EAN-13 labels.
        </p>
      )}
      <div className="mt-4 rounded-2xl bg-[#F3F5F4] p-3">
        <div
          role="img"
          aria-label="Label preview"
          className="mx-auto w-fit max-w-full overflow-x-auto rounded-md bg-white px-3 py-3 font-mono text-[11px] leading-[1.45] text-[#091413] shadow-[0_1px_3px_rgba(9,20,19,0.12)]"
          style={{ width: `${preview.columns}ch` }}
        >
          {preview.preview.map((line, index) => (
            <div key={index} className={`whitespace-pre ${line.bold ? 'font-bold' : ''}`} style={{ textAlign: line.align }}>
              {line.text || ' '}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
