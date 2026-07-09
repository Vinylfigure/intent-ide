import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateBaseUrl } from '@/lib/server/validateBaseUrl'

// validateBaseUrl(raw) guards the client-supplied `x-base-url` header on the
// LLM proxy routes. Contract:
//   - empty string  -> null (no custom base URL = default provider endpoint)
//   - non-production -> null always (local dev must keep hitting Ollama)
//   - production    -> reject unparseable URLs, non-https, localhost-ish
//                      hostnames, private/loopback/link-local IPv4 and IPv6
//                      (including WHATWG-normalized and v4-mapped spellings)
//
// NOTE on normalization: Node's WHATWG URL parser canonicalizes hostnames
// before this function ever sees them — `127.1`, `0x7f.0.0.1`, and decimal
// `2130706433` all become `127.0.0.1`, and `[::ffff:127.0.0.1]` becomes the
// hex-group form `[::ffff:7f00:1]`. The tests below feed the RAW attacker
// strings so the guard is exercised against what the parser actually emits.

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Non-production: everything passes (Ollama/local dev) ────────────────────

describe('validateBaseUrl — non-production is a no-op', () => {
  const permissive = [
    'http://localhost:11434',
    'http://127.0.0.1:11434/v1',
    'https://[::1]:8443',
    'http://192.168.1.50:8080',
    'http://169.254.169.254/latest/meta-data',
    'not a url at all',
  ]

  it('allows anything under vitest default NODE_ENV (test)', () => {
    for (const raw of permissive) {
      expect(validateBaseUrl(raw)).toBeNull()
    }
  })

  it('allows anything under NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    for (const raw of permissive) {
      expect(validateBaseUrl(raw)).toBeNull()
    }
  })
})

// ── Production behavior ──────────────────────────────────────────────────────

describe('validateBaseUrl — production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })

  it('allows an empty string (no custom base URL supplied)', () => {
    expect(validateBaseUrl('')).toBeNull()
  })

  it('allows legitimate public https BYOK endpoints', () => {
    const allowed = [
      'https://api.openai.com/v1',
      'https://api.groq.com/openai/v1',
      'https://api.together.xyz/v1',
      'https://my-vllm.example.com:8443/v1',
    ]
    for (const raw of allowed) {
      expect(validateBaseUrl(raw)).toBeNull()
    }
  })

  it('rejects unparseable URLs', () => {
    const invalid = ['not a url', 'api.example.com/v1', '//example.com', 'https://', ':::']
    for (const raw of invalid) {
      expect(validateBaseUrl(raw)).toBe('Invalid base URL')
    }
  })

  it('rejects non-https schemes', () => {
    const nonHttps = [
      'http://api.example.com/v1',
      'ftp://example.com',
      'file:///etc/passwd',
      'ws://example.com',
    ]
    for (const raw of nonHttps) {
      expect(validateBaseUrl(raw)).toBe('Base URL must use https in production')
    }
  })

  describe('localhost-ish hostnames', () => {
    it('rejects localhost and blocked suffixes (case-insensitive via URL lowering)', () => {
      const blocked = [
        'https://localhost',
        'https://LOCALHOST:11434',
        'https://ollama.localhost',
        'https://printer.local',
        'https://db.internal',
        'https://svc.prod.Internal',
      ]
      for (const raw of blocked) {
        expect(validateBaseUrl(raw)).toBe('Base URL host is not allowed')
      }
    })

    it('does not over-match hostnames that merely contain the suffix words', () => {
      const allowed = [
        'https://mylocalhost.com', // "localhost" not a label suffix
        'https://internal.example.com', // ".internal" is a label, not the TLD
        'https://foo.internal-api.com',
      ]
      for (const raw of allowed) {
        expect(validateBaseUrl(raw)).toBeNull()
      }
    })

    it('rejects FQDN trailing-dot spellings (localhost. resolves like localhost)', () => {
      const blocked = [
        'https://localhost.',
        'https://metadata.google.internal.',
        'https://printer.local.',
      ]
      for (const raw of blocked) {
        expect(validateBaseUrl(raw)).toBe('Base URL host is not allowed')
      }
    })
  })

  describe('private IPv4 ranges', () => {
    const blocked = [
      'https://0.0.0.0', // unspecified (0.0.0.0/8)
      'https://10.0.0.1', // 10/8 lower edge
      'https://10.255.255.255', // 10/8 upper edge
      'https://127.0.0.1', // loopback
      'https://127.255.255.254', // loopback upper range
      'https://169.254.0.1', // link-local lower
      'https://169.254.169.254', // cloud metadata endpoint
      'https://172.16.0.1', // 172.16/12 lower edge
      'https://172.31.255.255', // 172.16/12 upper edge
      'https://192.168.0.1', // 192.168/16 lower
      'https://192.168.255.255', // 192.168/16 upper
      'https://10.0.0.1:8443', // port must not defeat the check
    ]

    for (const raw of blocked) {
      it(`rejects ${raw}`, () => {
        expect(validateBaseUrl(raw)).toBe('Base URL must not point at a private network')
      })
    }

    const allowed = [
      'https://9.255.255.255', // just below 10/8
      'https://11.0.0.1', // just above 10/8
      'https://126.255.255.255', // just below loopback
      'https://128.0.0.1', // just above loopback
      'https://169.253.255.255', // just below link-local
      'https://169.255.0.1', // just above link-local
      'https://172.15.255.255', // just below 172.16/12
      'https://172.32.0.1', // just above 172.16/12
      'https://192.167.255.255', // just below 192.168/16
      'https://192.169.0.1', // just above 192.168/16
      'https://8.8.8.8:8443',
      'https://1.1.1.1/v1',
    ]

    for (const raw of allowed) {
      it(`allows public ${raw}`, () => {
        expect(validateBaseUrl(raw)).toBeNull()
      })
    }
  })

  describe('IPv4 shorthand/encoding bypass vectors (WHATWG normalization)', () => {
    // Node's URL parser canonicalizes all of these to 127.0.0.1 before the
    // guard runs — assert the pipeline as a whole still blocks them.
    const spellings = [
      'https://127.1', // shorthand
      'https://2130706433', // decimal
      'https://0x7f.0.0.1', // hex octet
      'https://017700000001', // octal
    ]
    for (const raw of spellings) {
      it(`rejects loopback spelled as ${raw}`, () => {
        expect(validateBaseUrl(raw)).toBe('Base URL must not point at a private network')
      })
    }
  })

  describe('private IPv6 (bracketed literals)', () => {
    const blocked = [
      'https://[::1]', // loopback
      'https://[::]', // unspecified
      'https://[0:0:0:0:0:0:0:1]', // loopback, uncompressed spelling
      'https://[::1]:8443', // port must not defeat the check
      'https://[fc00::1]', // unique-local fc00::/7 lower
      'https://[fd12:3456:789a::1]', // unique-local fd
      'https://[fe80::1]', // link-local fe80::/10 lower
      'https://[FE80::1]', // case-insensitive
      'https://[febf::1]', // link-local upper edge (fe80::/10 ends at febf)
    ]

    for (const raw of blocked) {
      it(`rejects ${raw}`, () => {
        expect(validateBaseUrl(raw)).toBe('Base URL must not point at a private network')
      })
    }

    it('allows public IPv6 literals', () => {
      expect(validateBaseUrl('https://[2001:4860:4860::8888]')).toBeNull()
      expect(validateBaseUrl('https://[2607:f8b0:4004:800::200e]/v1')).toBeNull()
    })

    it('does not confuse fc/fd/fe-prefixed DNS hostnames with IPv6 literals', () => {
      expect(validateBaseUrl('https://fcbarcelona.com')).toBeNull()
      expect(validateBaseUrl('https://fdn.example.com')).toBeNull()
      expect(validateBaseUrl('https://fe80.example.com')).toBeNull()
    })
  })

  describe('v4-mapped IPv6 (::ffff:0:0/96)', () => {
    // CRITICAL: WHATWG URL serializes v4-mapped addresses as hex groups —
    // new URL('https://[::ffff:127.0.0.1]').hostname === '[::ffff:7f00:1]' —
    // so the guard MUST handle the hex-group spelling, not just dotted-quad.
    const blocked = [
      'https://[::ffff:127.0.0.1]', // dotted input, normalized to hex by URL
      'https://[::ffff:7f00:1]', // loopback, hex-group spelling direct
      'https://[::ffff:10.0.0.1]', // 10/8 via mapping
      'https://[::ffff:a00:1]', // 10.0.0.1 hex spelling
      'https://[::ffff:169.254.169.254]', // cloud metadata via mapping
      'https://[::ffff:a9fe:a9fe]', // 169.254.169.254 hex spelling
      'https://[::ffff:192.168.1.1]', // 192.168/16 via mapping
      'https://[::ffff:0:1]', // 0.0.0.1 (0/8) via mapping
    ]

    for (const raw of blocked) {
      it(`rejects ${raw}`, () => {
        expect(validateBaseUrl(raw)).toBe('Base URL must not point at a private network')
      })
    }

    it('allows v4-mapped PUBLIC addresses in both spellings', () => {
      expect(validateBaseUrl('https://[::ffff:8.8.8.8]')).toBeNull()
      expect(validateBaseUrl('https://[::ffff:808:808]')).toBeNull()
    })

    it('boundary: 172.15 allowed, 172.16 and 172.31 blocked, 172.32 allowed — via mapping', () => {
      expect(validateBaseUrl('https://[::ffff:172.15.0.1]')).toBeNull()
      expect(validateBaseUrl('https://[::ffff:172.16.0.1]')).toBe(
        'Base URL must not point at a private network',
      )
      expect(validateBaseUrl('https://[::ffff:172.31.255.255]')).toBe(
        'Base URL must not point at a private network',
      )
      expect(validateBaseUrl('https://[::ffff:172.32.0.1]')).toBeNull()
    })
  })
})
