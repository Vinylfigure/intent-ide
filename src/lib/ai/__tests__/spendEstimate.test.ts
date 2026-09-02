import { describe, it, expect, beforeEach } from 'vitest'
import {
  addEstimate,
  getSessionEstimate,
  addTranscriptionEstimate,
  getTranscriptionEstimate,
  resetSessionEstimate,
} from '../spendEstimate'

beforeEach(() => {
  resetSessionEstimate()
})

describe('spendEstimate', () => {
  it('starts at zero', () => {
    expect(getSessionEstimate()).toBe(0)
  })

  it('accumulates and converts chars to tokens at ~4 chars/token', () => {
    addEstimate(400)
    expect(getSessionEstimate()).toBe(100)
    addEstimate(400)
    expect(getSessionEstimate()).toBe(200)
  })

  it('rounds the token estimate', () => {
    addEstimate(6) // 1.5 tokens → 2
    expect(getSessionEstimate()).toBe(2)
  })

  it('ignores junk input (negative, zero, NaN, Infinity)', () => {
    addEstimate(-100)
    addEstimate(0)
    addEstimate(NaN)
    addEstimate(Infinity)
    expect(getSessionEstimate()).toBe(0)
  })

  it('resets to zero', () => {
    addEstimate(4000)
    expect(getSessionEstimate()).toBe(1000)
    resetSessionEstimate()
    expect(getSessionEstimate()).toBe(0)
  })
})

describe('transcription estimate', () => {
  it('starts at zero', () => {
    expect(getTranscriptionEstimate()).toBe(0)
  })

  it('accumulates bytes, tracked separately from the token estimate', () => {
    addTranscriptionEstimate(1000)
    expect(getTranscriptionEstimate()).toBe(1000)
    addTranscriptionEstimate(500)
    expect(getTranscriptionEstimate()).toBe(1500)
    expect(getSessionEstimate()).toBe(0)
  })

  it('ignores junk input (negative, zero, NaN, Infinity)', () => {
    addTranscriptionEstimate(-100)
    addTranscriptionEstimate(0)
    addTranscriptionEstimate(NaN)
    addTranscriptionEstimate(Infinity)
    expect(getTranscriptionEstimate()).toBe(0)
  })

  it('resets to zero along with the token estimate', () => {
    addEstimate(400)
    addTranscriptionEstimate(2000)
    resetSessionEstimate()
    expect(getSessionEstimate()).toBe(0)
    expect(getTranscriptionEstimate()).toBe(0)
  })
})
