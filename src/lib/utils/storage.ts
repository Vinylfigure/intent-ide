// localStorage wrapper with JSON serialization
export function getStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : defaultValue
  } catch {
    return defaultValue
  }
}

export function setStorageItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.error('Failed to write to localStorage:', err)
  }
}

export function removeStorageItem(key: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(key)
}

export function clearIntentIDEStorage(): void {
  if (typeof window === 'undefined') return
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('intent-ide-'))
  keys.forEach((k) => localStorage.removeItem(k))
}
