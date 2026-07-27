import { describe, it, expect, beforeEach } from 'vitest'
import { useContactStore } from '@/store/contactStore'
import type { PendingContactChange } from '@/features/carddav/types'

const BOOK_ID = 'book-1'

function change(
  id: string,
  type: PendingContactChange['type'],
  contactId: string
): PendingContactChange {
  return {
    id,
    type,
    contactId,
    addressBookId: BOOK_ID,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  }
}

beforeEach(() => {
  useContactStore.setState({ contacts: [], addressBooks: [], pendingChanges: [] })
})

describe('contactStore — pending change queue', () => {
  it('collapses repeated updates for the same contact', () => {
    const { addPendingChange } = useContactStore.getState()
    addPendingChange(change('c1', 'update', 'contact-1'))
    addPendingChange(change('c2', 'update', 'contact-1'))

    const queue = useContactStore.getState().pendingChanges
    expect(queue).toHaveLength(1)
    expect(queue[0]!.id).toBe('c2')
  })

  it('cancels out a create followed by a delete', () => {
    const { addPendingChange } = useContactStore.getState()
    addPendingChange(change('c1', 'create', 'contact-1'))
    addPendingChange(change('c2', 'delete', 'contact-1'))

    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
  })

  it('absorbs an update into a queued create', () => {
    const { addPendingChange } = useContactStore.getState()
    addPendingChange(change('c1', 'create', 'contact-1'))
    addPendingChange(change('c2', 'update', 'contact-1'))

    const queue = useContactStore.getState().pendingChanges
    expect(queue).toHaveLength(1)
    expect(queue[0]!.type).toBe('create')
  })

  it('keeps changes for other contacts untouched', () => {
    const { addPendingChange } = useContactStore.getState()
    addPendingChange(change('c1', 'update', 'contact-1'))
    addPendingChange(change('c2', 'update', 'contact-2'))
    addPendingChange(change('c3', 'delete', 'contact-1'))

    const queue = useContactStore.getState().pendingChanges
    expect(queue.map((c) => c.id).sort()).toEqual(['c2', 'c3'])
  })

  it('increments retryCount', () => {
    const { addPendingChange, incrementRetryCount } = useContactStore.getState()
    addPendingChange(change('c1', 'delete', 'contact-1'))

    incrementRetryCount('c1')
    incrementRetryCount('c1')

    expect(useContactStore.getState().pendingChanges[0]!.retryCount).toBe(2)
  })
})
