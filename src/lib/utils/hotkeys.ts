type HotkeyHandler = (e: KeyboardEvent) => void

interface HotkeyBinding {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  handler: HotkeyHandler
}

const bindings: HotkeyBinding[] = []

export function registerHotkey(binding: HotkeyBinding): () => void {
  bindings.push(binding)
  return () => {
    const index = bindings.indexOf(binding)
    if (index >= 0) bindings.splice(index, 1)
  }
}

export function initHotkeyListener(): () => void {
  function handleKeyDown(e: KeyboardEvent) {
    for (const binding of bindings) {
      const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase()
      const ctrlMatch = !binding.ctrl || e.ctrlKey
      const metaMatch = !binding.meta || e.metaKey
      const shiftMatch = !binding.shift || e.shiftKey
      const altMatch = !binding.alt || e.altKey

      if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
        binding.handler(e)
        return
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}
