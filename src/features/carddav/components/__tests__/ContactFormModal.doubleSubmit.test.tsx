import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ContactFormModal } from '../ContactFormModal'

const onSave = vi.fn()
const onClose = vi.fn()

function renderModal() {
  return render(
    <ContactFormModal
      isOpen
      onClose={onClose}
      contact={null}
      addressBookId="book-1"
      accountId="acct-1"
      onSave={onSave}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onSave.mockResolvedValue(undefined)
})

describe('ContactFormModal — double submit', () => {
  // Save mints a fresh uuid on every call, so two clicks used to create two contacts.
  it('creates only one contact when Save is clicked twice in a row', async () => {
    renderModal()

    fireEvent.change(screen.getByPlaceholderText('New Contact'), {
      target: { value: 'Bob' },
    })

    const save = screen.getByRole('button', { name: /save/i })
    fireEvent.click(save)
    fireEvent.click(save)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('stays clickable when the save was rejected by validation', async () => {
    renderModal()

    // No name entered at all — the form refuses and must not latch the button
    const save = screen.getByRole('button', { name: /save/i })
    fireEvent.click(save)

    await waitFor(() => expect(save).not.toBeDisabled())
    expect(onSave).not.toHaveBeenCalled()
  })
})
