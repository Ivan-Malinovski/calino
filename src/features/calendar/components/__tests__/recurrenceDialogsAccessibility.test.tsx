import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecurrenceDialog } from '../RecurrenceDialog'
import { DeleteDialog } from '../DeleteDialog'

/**
 * Accessibility for the recurring-scope dialogs: both were `role="dialog"`
 * with no accessible name and no focus trap. The name comes from the visible
 * heading via `aria-labelledby` (so screen readers announce "Edit recurring
 * event", not just "dialog"), and `useModalDismiss` handles Escape-to-close,
 * focus trapping, and focus restore — the same plumbing every other modal
 * uses.
 */
describe('recurring scope dialogs — accessibility', () => {
  describe('RecurrenceDialog', () => {
    it('is named from the visible heading', () => {
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAccessibleName('Edit recurring event')
      // aria-labelledby points at the rendered title element, not a duplicated
      // aria-label that can drift from what the user sees.
      const labelledBy = dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()
      const heading = document.getElementById(labelledBy!)
      expect(heading).toBe(screen.getByText('Edit recurring event'))
    })

    it('names the task variant from its heading too', () => {
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} isTask />)
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit recurring task')
    })

    it('closes on Escape', async () => {
      const onClose = vi.fn()
      render(<RecurrenceDialog isOpen onClose={onClose} onConfirm={vi.fn()} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      // onClose fires after the exit animation completes.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('moves focus into the dialog when opened', () => {
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      // useModalDismiss traps focus; the first focusable is the close button.
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    })
  })

  describe('DeleteDialog', () => {
    it('is named from the visible heading', () => {
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAccessibleName('Delete recurring event')
      const labelledBy = dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()
      expect(document.getElementById(labelledBy!)).toBe(screen.getByText('Delete recurring event'))
    })

    it('names the task variant from its heading too', () => {
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} isTask />)
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Delete recurring task')
    })

    it('closes on Escape', async () => {
      const onClose = vi.fn()
      render(<DeleteDialog isOpen onClose={onClose} onConfirm={vi.fn()} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('moves focus into the dialog when opened', () => {
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      // useModalDismiss traps focus; the first focusable is the close button.
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    })
  })
})
