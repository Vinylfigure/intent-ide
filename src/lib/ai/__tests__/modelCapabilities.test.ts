import { describe, it, expect } from 'vitest'
import {
  modelRejectsSampling,
  pickUtilityModel,
  providerCapabilities,
} from '@/lib/ai/modelCapabilities'

// modelRejectsSampling(model) is true when the (case-insensitive) id contains
// one of the sampling-rejecting frontier families: opus-4-7, opus-4-8, fable-5,
// or mythos.  Everything else — current sampling-accepting Claude models, other
// providers, and junk input — must be false.

// ── Rejecting families → true ─────────────────────────────────────────────────

describe('modelRejectsSampling — rejecting frontier families', () => {
  const rejecting = [
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-mythos',
  ]

  for (const model of rejecting) {
    it(`returns true for "${model}"`, () => {
      expect(modelRejectsSampling(model)).toBe(true)
    })
  }

  it('matches even when the family token is embedded in a longer id', () => {
    expect(modelRejectsSampling('claude-opus-4-8-20260101')).toBe(true)
    expect(modelRejectsSampling('anthropic/claude-fable-5-preview')).toBe(true)
    expect(modelRejectsSampling('us.anthropic.claude-mythos-v1')).toBe(true)
    expect(modelRejectsSampling('claude-opus-4-7[1m]')).toBe(true)
  })
})

// ── Case-insensitivity ────────────────────────────────────────────────────────

describe('modelRejectsSampling — case-insensitivity', () => {
  it('matches uppercase ids', () => {
    expect(modelRejectsSampling('CLAUDE-OPUS-4-8')).toBe(true)
    expect(modelRejectsSampling('CLAUDE-FABLE-5')).toBe(true)
    expect(modelRejectsSampling('MYTHOS')).toBe(true)
  })

  it('matches mixed-case ids', () => {
    expect(modelRejectsSampling('Claude-Opus-4-7')).toBe(true)
    expect(modelRejectsSampling('Claude-Mythos')).toBe(true)
  })
})

// ── Current non-rejecting Claude models → false ───────────────────────────────

describe('modelRejectsSampling — sampling-accepting Claude models', () => {
  const accepting = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ]

  for (const model of accepting) {
    it(`returns false for "${model}"`, () => {
      expect(modelRejectsSampling(model)).toBe(false)
    })
  }

  it('does not over-match similar-but-distinct opus versions', () => {
    // 4-6 is accepting; only 4-7 and 4-8 reject.
    expect(modelRejectsSampling('claude-opus-4-6')).toBe(false)
    expect(modelRejectsSampling('claude-opus-4-5')).toBe(false)
  })
})

// ── Other providers → false ───────────────────────────────────────────────────

describe('modelRejectsSampling — non-Claude providers', () => {
  const otherProviders = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'llama3.2',
    'llama3.1',
    'mistral',
    'qwen2.5',
    'deepseek-r1',
    'phi3',
  ]

  for (const model of otherProviders) {
    it(`returns false for "${model}"`, () => {
      expect(modelRejectsSampling(model)).toBe(false)
    })
  }
})

// ── Empty / garbage input → false ─────────────────────────────────────────────

describe('modelRejectsSampling — empty and garbage input', () => {
  it('returns false for empty string', () => {
    expect(modelRejectsSampling('')).toBe(false)
  })

  it('returns false for null/undefined coerced via the `|| ""` guard', () => {
    // The implementation guards with `(model || '')`, so nullish input is safe.
    expect(modelRejectsSampling(null as unknown as string)).toBe(false)
    expect(modelRejectsSampling(undefined as unknown as string)).toBe(false)
  })

  it('returns false for unrelated garbage strings', () => {
    expect(modelRejectsSampling('not-a-real-model')).toBe(false)
    expect(modelRejectsSampling('opus')).toBe(false)
    expect(modelRejectsSampling('fable')).toBe(false)
    expect(modelRejectsSampling('4-8')).toBe(false)
    expect(modelRejectsSampling('   ')).toBe(false)
  })
})

// ── pickUtilityModel ──────────────────────────────────────────────────────────

describe('pickUtilityModel', () => {
  it('pins Claude utility calls to Haiku regardless of the selected model', () => {
    expect(pickUtilityModel({ provider: 'claude', model: 'claude-fable-5' })).toBe(
      'claude-haiku-4-5',
    )
    expect(pickUtilityModel({ provider: 'claude', model: 'claude-opus-4-8' })).toBe(
      'claude-haiku-4-5',
    )
    expect(pickUtilityModel({ provider: 'claude', model: 'claude-haiku-4-5' })).toBe(
      'claude-haiku-4-5',
    )
  })

  it('keeps the selected model for non-Claude providers (no cheaper sibling assumed)', () => {
    expect(pickUtilityModel({ provider: 'openai', model: 'gpt-4o' })).toBe('gpt-4o')
    expect(pickUtilityModel({ provider: 'ollama', model: 'llama3.2' })).toBe('llama3.2')
  })

  it('keeps the selected model for openrouter slugs and unknown providers', () => {
    expect(
      pickUtilityModel({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' }),
    ).toBe('anthropic/claude-sonnet-4.6')
    expect(pickUtilityModel({ provider: 'groq', model: 'mixtral-8x7b' })).toBe('mixtral-8x7b')
  })
})

// ── modelRejectsSampling on OpenRouter-style slugs ────────────────────────────

describe('modelRejectsSampling — openrouter slugs', () => {
  it('matches rejecting families embedded in vendor-prefixed slugs', () => {
    expect(modelRejectsSampling('anthropic/claude-opus-4-8')).toBe(true)
    expect(modelRejectsSampling('anthropic/claude-fable-5')).toBe(true)
  })

  it('does not match sampling-accepting or non-Claude slugs', () => {
    expect(modelRejectsSampling('anthropic/claude-sonnet-4.6')).toBe(false)
    expect(modelRejectsSampling('meta-llama/llama-3.3-70b-instruct')).toBe(false)
    expect(modelRejectsSampling('deepseek/deepseek-chat')).toBe(false)
  })
})

// ── providerCapabilities ──────────────────────────────────────────────────────

describe('providerCapabilities', () => {
  it('claude: no logprobs, embeddings only behind a base-URL proxy, transcription available', () => {
    expect(providerCapabilities('claude')).toEqual({
      logprobs: false,
      embeddings: false,
      voiceTranscription: true,
    })
    expect(providerCapabilities('claude', 'https://proxy.example.com')).toEqual({
      logprobs: false,
      embeddings: true,
      voiceTranscription: true,
    })
  })

  it('openai: everything available', () => {
    expect(providerCapabilities('openai')).toEqual({
      logprobs: true,
      embeddings: true,
      voiceTranscription: true,
    })
  })

  it('openrouter: chat only — no logprobs, no embeddings, transcription via a separate key', () => {
    expect(providerCapabilities('openrouter')).toEqual({
      logprobs: false,
      embeddings: false,
      voiceTranscription: true,
    })
    // A base-URL override does not unlock embeddings on OpenRouter.
    expect(providerCapabilities('openrouter', 'https://openrouter.ai/api/v1').embeddings).toBe(false)
  })

  it('ollama: local embeddings, no hosted transcription', () => {
    expect(providerCapabilities('ollama')).toEqual({
      logprobs: false,
      embeddings: true,
      voiceTranscription: false,
    })
  })

  it('treats unknown providers like claude (the server-side fallback)', () => {
    expect(providerCapabilities('groq')).toEqual(providerCapabilities('claude'))
  })
})
