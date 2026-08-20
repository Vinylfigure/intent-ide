import { describe, it, expect, beforeEach } from 'vitest'
import { useLayoutStore, normalizeAnswerPlacement, ZERO_OFFSET } from '../layoutStore'

beforeEach(() => {
  useLayoutStore.setState({ answerPlacement: 'sidebar', floatingOffset: ZERO_OFFSET })
})

describe('layoutStore', () => {
  it('defaults to the sidebar placement', () => {
    expect(useLayoutStore.getState().answerPlacement).toBe('sidebar')
  })

  it('toggles between sidebar and floating', () => {
    const { toggleAnswerPlacement } = useLayoutStore.getState()
    toggleAnswerPlacement()
    expect(useLayoutStore.getState().answerPlacement).toBe('floating')
    useLayoutStore.getState().toggleAnswerPlacement()
    expect(useLayoutStore.getState().answerPlacement).toBe('sidebar')
  })

  it('re-parks the floating panel whenever the placement changes', () => {
    useLayoutStore.getState().setFloatingOffset({ dx: 120, dy: -60 })
    expect(useLayoutStore.getState().floatingOffset).toEqual({ dx: 120, dy: -60 })

    useLayoutStore.getState().setAnswerPlacement('floating')
    expect(useLayoutStore.getState().floatingOffset).toEqual(ZERO_OFFSET)

    useLayoutStore.getState().setFloatingOffset({ dx: 30, dy: 30 })
    useLayoutStore.getState().toggleAnswerPlacement()
    expect(useLayoutStore.getState().floatingOffset).toEqual(ZERO_OFFSET)
  })

  it('resetFloatingOffset returns the panel to its computed place', () => {
    useLayoutStore.getState().setFloatingOffset({ dx: 9, dy: 9 })
    useLayoutStore.getState().resetFloatingOffset()
    expect(useLayoutStore.getState().floatingOffset).toEqual(ZERO_OFFSET)
  })

  it('rejects a placement value this build does not know', () => {
    useLayoutStore.getState().setAnswerPlacement('inline' as never)
    expect(useLayoutStore.getState().answerPlacement).toBe('sidebar')
  })
})

describe('normalizeAnswerPlacement', () => {
  it('passes through known placements', () => {
    expect(normalizeAnswerPlacement('sidebar')).toBe('sidebar')
    expect(normalizeAnswerPlacement('floating')).toBe('floating')
  })

  it('falls back to sidebar for anything stale or malformed', () => {
    expect(normalizeAnswerPlacement('inline')).toBe('sidebar')
    expect(normalizeAnswerPlacement(undefined)).toBe('sidebar')
    expect(normalizeAnswerPlacement(null)).toBe('sidebar')
    expect(normalizeAnswerPlacement(3)).toBe('sidebar')
  })
})
