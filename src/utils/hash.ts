export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const ITERATIONS = 600_000
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

/** Versioned, random per-credential salt. Legacy hashes are upgraded only after verification. */
export async function hashPassword(text: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${ITERATIONS}$${hex(salt)}$${await derive(text, salt, ITERATIONS)}`
}

async function derive(text: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, key, 256)
  return hex(new Uint8Array(bits))
}

export async function verifyPassword(text: string, stored: string): Promise<boolean> {
  if (/^[a-f0-9]{64}$/.test(stored)) return (await sha256(text)) === stored
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || !/^[a-f0-9]{32}$/.test(parts[2] ?? '') || !/^[a-f0-9]{64}$/.test(parts[3] ?? '')) return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false
  const salt = Uint8Array.from(parts[2]!.match(/../g)!, part => parseInt(part, 16))
  const actual = await derive(text, salt, iterations)
  let difference = 0
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ parts[3]!.charCodeAt(index)
  return difference === 0
}
