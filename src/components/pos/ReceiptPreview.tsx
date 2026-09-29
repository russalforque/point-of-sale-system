import { useMemo } from 'react'

import { buildReceipt } from '../../services/printer'
import type { Sale, StoreSetting } from '../../types'
import { getPrinterConfig } from '../../utils/printerConfig'

/**
 * On-screen copy of the thermal receipt, built by the exact same formatter that produces the
 * ESC/POS bytes - so what the cashier sees here is what the POS-5890U-L prints (32 columns on 58mm).
 */
export function ReceiptPreview({ sale, settings }: { sale: Sale; settings: StoreSetting }) {
  const paperWidth = getPrinterConfig().paperWidth
  const receipt = useMemo(() => buildReceipt(sale, settings, paperWidth), [sale, settings, paperWidth])

  return (
    <div className="rounded-2xl bg-[#F3F5F4] p-3">
      <div className="mx-auto w-fit max-w-full overflow-x-auto rounded-md bg-white px-3 py-4 shadow-[0_1px_3px_rgba(9,20,19,0.12)]">
        <div
          role="img"
          aria-label={`Receipt preview for invoice ${sale.invoiceNumber}`}
          className="font-mono text-[11px] leading-[1.45] text-[#091413]"
          style={{ width: `${receipt.columns}ch` }}
        >
          {receipt.preview.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre ${line.bold ? 'font-bold' : ''} ${line.tall ? 'py-1' : ''}`}
              style={{ textAlign: line.align }}
            >
              {line.tall ? (
                // Printer "tall" mode doubles height only, so keep the same character width
                // (columns stay aligned with every other line) and stretch vertically.
                <span className="inline-block origin-center scale-y-[1.6]">{line.text || ' '}</span>
              ) : (
                line.text || ' '
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ReceiptPreview
