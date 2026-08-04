import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecurrenceDialog } from '../RecurrenceDialog'
import { DeleteDialog } from '../DeleteDialog'

/**
 * Issue #96 follow-up — both scope dialogs hardcoded "event", so editing or
 * deleting a recurring *task* offered "All events" / "This event only". The
 * `isTask` prop swaps the noun; it defaults to false so every event call site
 * keeps its original copy.
 */
describe('recurring scope dialogs — task vs event wording', () => {
  describe('RecurrenceDialog', () => {
    it('says "event" by default', () => {
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      expect(screen.getByText('Edit recurring event')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^all events$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^this event only$/i })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^this and following events$/i })
      ).toBeInTheDocument()
    })

    it('says "task" when isTask is set', () => {
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} isTask />)

      expect(screen.getByText('Edit recurring task')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^all tasks$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^this task only$/i })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^this and following tasks$/i })
      ).toBeInTheDocument()
      // The word it replaced is gone, not merely joined by the new one.
      expect(screen.queryByRole('button', { name: /events/i })).not.toBeInTheDocument()
    })

    it('reports the chosen scope regardless of wording', () => {
      const onConfirm = vi.fn()
      render(<RecurrenceDialog isOpen onClose={vi.fn()} onConfirm={onConfirm} isTask />)

      screen.getByRole('button', { name: /^this and following tasks$/i }).click()
      expect(onConfirm).toHaveBeenCalledWith('future')
    })
  })

  describe('DeleteDialog', () => {
    it('says "event" by default', () => {
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} />)

      expect(screen.getByText('Delete recurring event')).toBeInTheDocument()
      expect(screen.getByText(/how would you like to delete this event\?/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^all events$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^this event only$/i })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^this and following events$/i })
      ).toBeInTheDocument()
    })

    it('says "task" when isTask is set', () => {
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={vi.fn()} isTask />)

      expect(screen.getByText('Delete recurring task')).toBeInTheDocument()
      expect(screen.getByText(/how would you like to delete this task\?/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^all tasks$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^this task only$/i })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^this and following tasks$/i })
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /events/i })).not.toBeInTheDocument()
    })

    it('reports the chosen scope regardless of wording', () => {
      const onConfirm = vi.fn()
      render(<DeleteDialog isOpen onClose={vi.fn()} onConfirm={onConfirm} isTask />)

      screen.getByRole('button', { name: /^this task only$/i }).click()
      expect(onConfirm).toHaveBeenCalledWith('this')
    })
  })
})
