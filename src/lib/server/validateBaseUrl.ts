/**
 * Guard for the client-supplied `x-base-url` header on the LLM proxy routes.
 *
 * BYOK deliberately allows arbitrary OpenAI-compatible endpoints (Groq,
 * Together, self-hosted vLLM), so this is a private-network blocklist rather
 * than a host allowlist. Enforced only in production builds — local dev must
 * keep working against Ollama on localhost.
 *
 * Residual risk accepted: DNS rebinding of a public hostname to a private IP.
 * Vercel functions have no privileged internal network behind them, so the
 * realistic exposure (cloud metadata endpoints, egress port-scanning) is
 * covered by the checks below.
 */

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal']

/** Returns an error message when the base URL must be rejected, else null. */
export function validateBaseUrl(raw: string): string | null {
  if (!raw) return null
  if (process.env.NODE_ENV !== 'production') return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'Invalid base URL'
  }

  if (url.protocol !== 'https:') {
    return 'Base URL must use https in production'
  }

  // Strip FQDN trailing dots — `localhost.` resolves like `localhost` but
  // would slip past the string checks below.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  const bare = host.replace(/^\[|\]$/g, '') // IPv6 literals arrive bracketed

  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return 'Base URL host is not allowed'
  }
  if (isPrivateIPv4(bare) || isPrivateIPv6(bare)) {
    return 'Base URL must not point at a private network'
  }

  return null
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true // 0/8, 10/8, loopback
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  return false
}

function isPrivateIPv6(host: string): boolean {
  if (!host.includes(':')) return false
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') return true // unspecified, loopback
  if (h.startsWith('fc') || h.startsWith('fd')) return true // fc00::/7 unique-local
  if (/^fe[89ab]/.test(h)) return true // fe80::/10 link-local
  if (h.startsWith('::ffff:')) return isPrivateV4Mapped(h.slice(7)) // v4-mapped
  return false
}

/**
 * v4-mapped tail after the `::ffff:` prefix. WHATWG URL serializes these as
 * hex groups (`new URL('https://[::ffff:127.0.0.1]').hostname` is
 * `'[::ffff:7f00:1]'`), NOT dotted-quad, so both spellings must decode to the
 * embedded IPv4 address. Anything unrecognizable fails closed.
 */
function isPrivateV4Mapped(tail: string): boolean {
  if (tail.includes('.')) return isPrivateIPv4(tail) // dotted-quad spelling
  const groups = tail.split(':')
  if (
    groups.length < 1 ||
    groups.length > 2 ||
    !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))
  ) {
    return true // not a decodable v4-mapped tail — fail closed
  }
  const hi = groups.length === 2 ? parseInt(groups[0], 16) : 0
  const lo = parseInt(groups[groups.length - 1], 16)
  return isPrivateIPv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
}
