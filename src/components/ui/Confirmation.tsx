'use client'

import { useCallback } from 'react'

interface ConfirmationProps {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}

/**
 * Human-in-the-loop (HITL) confirmation gate.
 * Wraps destructive or significant actions to ensure the user actively verifies
 * semantic alignment before applying changes.
 */
export function Confirmation({
  title,
  description,
  confirmLabel = 'Apply',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  children,
}: ConfirmationProps) {
  const handleConfirm = useCallback(() => {
    onConfirm()
  }, [onConfirm])

  const handleCancel = useCallback(() => {
    onCancel()
  }, [onCancel])

  return (
    <div className="confirmation-gate">
      <div className="confirmation-header">
        <h3 className="confirmation-title">{title}</h3>
        {description && <p className="confirmation-description">{description}</p>}
      </div>

      {children && <div className="confirmation-body">{children}</div>}

      <div className="confirmation-actions">
        <button
          className="confirmation-btn confirmation-btn-cancel"
          onClick={handleCancel}
        >
          {cancelLabel}
        </button>
        <button
          className={`confirmation-btn ${
            variant === 'destructive'
              ? 'confirmation-btn-destructive'
              : 'confirmation-btn-confirm'
          }`}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
