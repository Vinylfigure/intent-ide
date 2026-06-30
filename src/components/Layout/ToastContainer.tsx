'use client'

import { useEffect, useRef } from 'react'
import { useToastStore } from '@/stores/toastStore'
import type { ToastType } from '@/stores/toastStore'

const typeStyles: Record<ToastType, string> = {
  info: 'bg-ink text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-accent text-white',
  loading: 'bg-ink text-white',
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = timersRef.current

    for (const toast of toasts) {
      if (toast.type === 'loading') continue
      if (timers.has(toast.id)) continue

      const timer = setTimeout(() => {
        removeToast(toast.id)
        timers.delete(toast.id)
      }, 4000)

      timers.set(toast.id, timer)
    }

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [toasts, removeToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-28 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg shadow-lg px-4 py-2.5 text-sm flex items-center gap-2 animate-in slide-in-from-right-5 fade-in duration-200 ${typeStyles[toast.type]}`}
        >
          {toast.type === 'loading' && <Spinner />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  )
}
