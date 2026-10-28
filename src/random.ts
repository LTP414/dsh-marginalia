/**
 * UUID generation that works in the two contexts this bundle runs in:
 *
 * - Node 22+ exposes `crypto.randomUUID`.
 * - A browser on a plain-HTTP origin (the common LAN Web GUI) exposes `crypto`
 *   and `getRandomValues`, but **not** `randomUUID`: the latter is restricted to
 *   secure contexts. `getRandomValues` is available in insecure contexts.
 *
 * A UUID here is an identifier, not a secret. The final fallback is still a
 * valid v4 shape so protocol validation never accepts a malformed id.
 */
const HEX = '0123456789abcdef'

function uuidFromBytes(bytes: Uint8Array): string {
  const value = new Uint8Array(16)
  value.set(bytes.subarray(0, 16))
  value[6] = ((value[6] ?? 0) & 0x0f) | 0x40
  value[8] = ((value[8] ?? 0) & 0x3f) | 0x80
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-'
    const byte = value[index] ?? 0
    out += HEX[byte >> 4]
    out += HEX[byte & 0x0f]
  }
  return out
}

function fillInsecure(bytes: Uint8Array): Uint8Array {
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

export function randomId(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // Fall through to getRandomValues.
    }
  }
  if (typeof crypto?.getRandomValues === 'function') {
    try {
      return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)))
    } catch {
      // Fall through to the non-cryptographic identifier fallback.
    }
  }
  return uuidFromBytes(fillInsecure(new Uint8Array(16)))
}
