import { describe, it, expect } from 'vitest'
import { parseClassification } from '../classification'

// The classifier now answers on two axes in one round-trip. It runs against
// whatever provider the reader configured, including small local models that
// will cheerfully answer "DIG" to a request for a JSON object — so the parse
// has to degrade in a chosen direction rather than throw or guess.
//
// The chosen direction: type degrades to the old substring match, relation
// degrades to 'about'. A wrong 'sparked_by' silently suppresses the
// undefined-term guard; a wrong 'about' merely reproduces what the tool did
// before this axis existed, and the reader can correct either in one click.

describe('parseClassification', () => {
  it('reads a clean JSON answer', () => {
    expect(parseClassification('{"type":"dig","relation":"sparked_by"}')).toEqual({
      type: 'dig',
      relation: 'sparked_by',
    })
  })

  it('survives a code fence and surrounding prose', () => {
    const raw = 'Sure! Here you go:\n```json\n{"type":"ask","relation":"about"}\n```'
    expect(parseClassification(raw)).toEqual({ type: 'ask', relation: 'about' })
  })

  it('falls back to the old substring match when the model answers a bare word', () => {
    // Exactly what this route returned before the relation axis existed.
    expect(parseClassification('EDIT')).toEqual({ type: 'edit', relation: 'about' })
    expect(parseClassification('  Dig.  ')).toEqual({ type: 'dig', relation: 'about' })
  })

  it('degrades relation to about rather than guessing, when only relation is bad', () => {
    expect(parseClassification('{"type":"ask","relation":"tangent"}')).toEqual({
      type: 'ask',
      relation: 'about',
    })
    expect(parseClassification('{"type":"ask"}')).toEqual({ type: 'ask', relation: 'about' })
  })

  it('recovers the type from the raw text when the JSON names an invalid one', () => {
    expect(parseClassification('{"type":"clarify","relation":"about"}').relation).toBe('about')
  })

  it('uses the suggested type when nothing is recoverable', () => {
    expect(parseClassification('¯\\_(ツ)_/¯', 'dig')).toEqual({ type: 'dig', relation: 'about' })
  })

  it('falls back to flag when there is no suggestion either', () => {
    expect(parseClassification('')).toEqual({ type: 'flag', relation: 'about' })
  })

  it('never throws on malformed JSON', () => {
    expect(() => parseClassification('{"type":"ask",')).not.toThrow()
    expect(parseClassification('{"type":"ask",')).toEqual({ type: 'ask', relation: 'about' })
  })

  it('ignores case and whitespace the model adds', () => {
    expect(parseClassification('{"type":" ASK ","relation":" Sparked_By "}')).toEqual({
      type: 'ask',
      relation: 'sparked_by',
    })
  })
})
