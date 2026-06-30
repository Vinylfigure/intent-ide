'use client'

import { create } from 'zustand'
import { generateId } from '@/lib/utils/id'

export type ToastType = 'info' | 'success' | 'error' | 'loading'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType) => string
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = generateId()
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }))
    return id
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}))
