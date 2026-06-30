import type { ChangeEntry } from './changeLog'

export interface ChangeGroup {
  label: string
  entries: ChangeEntry[]
}

export function groupByTime(entries: ChangeEntry[]): ChangeGroup[] {
  const now = Date.now()
  const fiveMin = 5 * 60 * 1000
  const oneHour = 60 * 60 * 1000

  const groups: ChangeGroup[] = []
  const justNow = entries.filter((e) => now - e.timestamp < fiveMin)
  const lastHour = entries.filter(
    (e) => now - e.timestamp >= fiveMin && now - e.timestamp < oneHour
  )
  const earlier = entries.filter((e) => now - e.timestamp >= oneHour)

  if (justNow.length) groups.push({ label: 'Just now', entries: justNow })
  if (lastHour.length) groups.push({ label: 'Last hour', entries: lastHour })
  if (earlier.length) groups.push({ label: 'Earlier', entries: earlier })

  return groups
}
