import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIImportReviewModal } from '../AIImportReviewModal'
import type { ExtractedEventFields } from '../../types'

const flyer: ExtractedEventFields = {
  title: 'Block Party',
  start: '2026-07-25T18:00',
  location: 'Main St',
}
const chore: ExtractedEventFields = { title: 'Renew passport', kind: 'task' }

function setup(candidates: ExtractedEventFields[]) {
  const onConfirm = vi.fn()
  const onConfirmAll = vi.fn()
  const onCancel = vi.fn()
  render(
    <AIImportReviewModal
      isOpen
      candidates={candidates}
      onConfirm={onConfirm}
      onConfirmAll={onConfirmAll}
      onCancel={onCancel}
    />
  )
  return { onConfirm, onConfirmAll, onCancel }
}

const queryCards = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-component="ai-import-candidate"]'))

const kindButton = (card: HTMLElement, kind: 'event' | 'task'): HTMLElement =>
  within(card).getByRole('button', { name: kind === 'event' ? 'Event' : 'Task' })

describe('AIImportReviewModal kind toggle', () => {
  it('defaults a candidate with no kind to Event', () => {
    setup([flyer])
    const [card] = queryCards()
    expect(card).toHaveAttribute('data-kind', 'event')
    expect(kindButton(card, 'event')).toHaveAttribute('aria-pressed', 'true')
  })

  it("starts on the model's suggested kind", () => {
    setup([chore])
    const [card] = queryCards()
    expect(card).toHaveAttribute('data-kind', 'task')
    expect(kindButton(card, 'task')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Renew passport')).toBeInTheDocument()
  })

  it('confirms a single candidate with the kind the user switched to', async () => {
    const user = userEvent.setup()
    const { onConfirm } = setup([flyer])
    await user.click(kindButton(queryCards()[0], 'task'))
    await user.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ ...flyer, kind: 'task' }))
  })

  it('does not change card selection when the toggle is tapped', async () => {
    const user = userEvent.setup()
    setup([flyer, chore])
    const card = queryCards()[0]
    expect(card).toHaveAttribute('data-selected', 'true')
    await user.click(kindButton(card, 'task'))
    expect(queryCards()[0]).toHaveAttribute('data-selected', 'true')
    expect(queryCards()[0]).toHaveAttribute('data-kind', 'task')
  })

  it('passes a mixed batch through with per-candidate kinds', async () => {
    const user = userEvent.setup()
    const { onConfirmAll } = setup([flyer, chore])
    await user.click(screen.getByRole('button', { name: 'Add all 2' }))
    expect(onConfirmAll).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Block Party', kind: 'event' }),
      expect.objectContaining({ title: 'Renew passport', kind: 'task' }),
    ])
  })

  it('falls back to onConfirm with the chosen kind when only one is selected', async () => {
    const user = userEvent.setup()
    const { onConfirm } = setup([flyer, chore])
    await user.click(queryCards()[0])
    await user.click(screen.getByRole('button', { name: 'Add 1 selected' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task' }))
  })

  it('labels a task candidate’s date as a due date', () => {
    setup([{ ...chore, start: '2026-08-01T00:00' }])
    expect(screen.getByText(/^Due /)).toBeInTheDocument()
  })
})
