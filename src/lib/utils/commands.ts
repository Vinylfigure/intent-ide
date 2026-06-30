export interface Command {
  id: string
  label: string
  hotkey?: string
  handler: () => void
}
