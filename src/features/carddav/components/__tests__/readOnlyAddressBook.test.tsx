import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useContactStore } from '@/store/contactStore'
import { parseVCard } from '../../adapter/vCardAdapter'
import type { AddressBook, Contact } from '../../types'
import { ContactDetail } from '../ContactDetail'
import { MergeDuplicatesModal } from '../MergeDuplicatesModal'

vi.mock('@/features/carddav/hooks/useCardDAV', () => ({
  useCardDAV: () => ({ syncAccount: vi.fn().mockResolvedValue(undefined) }),
}))

const PERSONAL = 'https://dav.example.com/alice/personal/'
const TEAM = 'https://dav.example.com/alice/team/'

function book(id: string, name: string, canWrite?: boolean): AddressBook {
  return {
    id,
    url: id,
    name,
    accountId: 'acct-1',
    ctag: null,
    syncToken: null,
    isVisible: true,
    canWrite,
  }
}

function contact(uid: string, name: string, addressBookId: string): Contact {
  const card = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${uid}`,
    `FN:${name}`,
    `EMAIL:${uid}@example.com`,
  ]
  return parseVCard([...card, 'END:VCARD'].join('\r\n'), addressBookId, 'acct-1')!
}

beforeEach(() => {
  useContactStore.setState({
    contacts: [],
    addressBooks: [book(PERSONAL, 'Personal', true), book(TEAM, 'Team Directory', false)],
    pendingChanges: [],
  })
})

describe('ContactDetail — contact of a read-only address book', () => {
  it('offers neither edit nor delete, and says the book is read-only', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <ContactDetail
        contact={contact('bob', 'Bob Example', TEAM)}
        onEdit={onEdit}
        onDelete={onDelete}
        onFieldSave={vi.fn()}
        readOnly
      />
    )

    expect(screen.getByRole('button', { name: 'Edit contact' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete contact' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete contact' }))
    expect(onEdit).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('Team Directory (read-only)')).toBeInTheDocument()
  })

  it('does not start an inline edit on double-click', () => {
    render(
      <ContactDetail contact={contact('bob', 'Bob Example', TEAM)} onFieldSave={vi.fn()} readOnly />
    )

    fireEvent.doubleClick(screen.getByRole('heading', { name: 'Bob Example' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('still edits a contact of a writable book', () => {
    render(
      <ContactDetail contact={contact('ann', 'Ann Example', PERSONAL)} onFieldSave={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Edit contact' })).toBeEnabled()
    fireEvent.doubleClick(screen.getByRole('heading', { name: 'Ann Example' }))
    expect(screen.getByRole('textbox')).toHaveValue('Ann Example')
  })
})

describe('MergeDuplicatesModal — read-only address books', () => {
  // A merge rewrites one contact and deletes the others; the server refuses both in
  // a read-only book.
  it('does not offer to merge a duplicate that lives in a read-only book', () => {
    const personalBob = contact('bob-1', 'Bob Example', PERSONAL)
    const teamBob = { ...contact('bob-2', 'Bob Example', TEAM), emails: personalBob.emails }
    useContactStore.setState({ contacts: [personalBob, teamBob] })

    render(<MergeDuplicatesModal isOpen onClose={vi.fn()} />)

    expect(screen.getByText('No duplicates found')).toBeInTheDocument()
  })

  it('still offers to merge duplicates between writable books', () => {
    const personalBob = contact('bob-1', 'Bob Example', PERSONAL)
    const otherBob = { ...contact('bob-2', 'Bob Example', PERSONAL), emails: personalBob.emails }
    useContactStore.setState({ contacts: [personalBob, otherBob] })

    render(<MergeDuplicatesModal isOpen onClose={vi.fn()} />)

    expect(screen.queryByText('No duplicates found')).not.toBeInTheDocument()
  })
})
