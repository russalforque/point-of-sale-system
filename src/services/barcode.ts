/**
 * Retail barcode helpers. EAN-13, UPC-A and EAN-8 end in a check digit; validating it catches
 * almost every typo in a hand-entered code. Codes the store makes for its own products use
 * the GS1 "in-store" prefix 200-299, so they can never clash with a manufacturer's barcode.
 */

/** GS1 check digit for the digits before it (works for EAN-8, UPC-A and EAN-13). */
export function gs1CheckDigit(body: string): number {
  let sum = 0
  // Weights alternate 3,1,3,1… starting from the digit next to the check digit.
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index])
    sum += index % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

/** Null when the code is fine, otherwise why it isn't. Non-GS1 codes (Code 128, letters) are accepted as is. */
export function barcodeProblem(code: string): string | null {
  if (!/^\d+$/.test(code)) return null
  if (code.length === 8 || code.length === 12 || code.length === 13) {
    const expected = gs1CheckDigit(code.slice(0, -1))
    if (Number(code[code.length - 1]) !== expected) {
      return `This barcode’s last digit should be ${expected}. Check for a typo, or scan it instead.`
    }
  }
  return null
}

/** A random in-store EAN-13 (prefix 200). Callers check it is unused before saving. */
export function randomInStoreEan13(): string {
  let body = '200'
  for (let index = 0; index < 9; index += 1) body += String(Math.floor(Math.random() * 10))
  return body + String(gs1CheckDigit(body))
}

/**
 * EAN-13 as the 95 bar modules a scanner reads (1 = bar, 0 = space), for drawing labels.
 * Returns null for anything that isn't a valid 13-digit code.
 */
export function ean13Modules(code: string): string | null {
  if (!/^\d{13}$/.test(code) || barcodeProblem(code)) return null
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
  const digits = code.split('').map(Number)
  const parity = PARITY[digits[0]!]!
  let bits = '101'
  for (let index = 1; index <= 6; index += 1) {
    const digit = digits[index]!
    bits += parity[index - 1] === 'L' ? L[digit] : G[digit]
  }
  bits += '01010'
  for (let index = 7; index <= 12; index += 1) bits += R[digits[index]!]
  bits += '101'
  return bits
}
