import { describe, it, expect, beforeEach } from 'vitest'
import { addEstimate, getSessionEstimate, resetSessionEstimate } from '../spendEstimate'

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
