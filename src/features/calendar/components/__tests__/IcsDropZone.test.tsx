import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { IcsDropZone } from '../IcsDropZone'
import { useCalendarStore } from '@/store/calendarStore'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:dropped-1@example.com
DTSTART:20260401T090000Z
DTEND:20260401T100000Z
SUMMARY:Dropped in
END:VEVENT
END:VCALENDAR`

/**
 * jsdom has no DataTransfer, and the drag events it does construct don't carry
 * one. Build the minimum surface IcsDropZone reads.
 */
function dragEvent(type: string, init: { types?: string[]; files?: File[] } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: init.types ?? [],
      files: init.files ?? [],
      dropEffect: 'none',
    },
  })
  return event
}

function icsFile(): File {
  return new File([ICS], 'dropped.ics', { type: 'text/calendar' })
}

describe('IcsDropZone', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      events: [],
      calendars: [
        {
          id: 'work',
          name: 'Work',
          color: '#4285F4',
          isVisible: true,
          isDefault: true,
          showTasksInViews: true,
        },
      ],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the overlay for a file drag', () => {
    render(<IcsDropZone />)

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }))
    })

    expect(screen.getByText(/drop .ics file to import events/i)).toBeInTheDocument()
  })

  it('ignores the app’s own internal drags', () => {
    render(<IcsDropZone />)

    const internal = dragEvent('dragenter', { types: ['event-move'] })
    act(() => {
      window.dispatchEvent(internal)
    })

    expect(screen.queryByText(/drop .ics file/i)).not.toBeInTheDocument()
    // Crucially, we must not preventDefault an internal drag or the app's own
    // drop targets stop receiving it.
    expect(internal.defaultPrevented).toBe(false)
  })

  it('keeps the overlay up while the pointer crosses child elements', () => {
    render(<IcsDropZone />)

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }))
      window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }))
      window.dispatchEvent(dragEvent('dragleave', { types: ['Files'] }))
    })
    expect(screen.getByText(/drop .ics file/i)).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(dragEvent('dragleave', { types: ['Files'] }))
    })
    expect(screen.queryByText(/drop .ics file/i)).not.toBeInTheDocument()
  })

  it('opens the import modal when a .ics file is dropped', async () => {
    render(<IcsDropZone />)

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }))
      window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: [icsFile()] }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-confirm')).toBeInTheDocument()
    })
    expect(screen.getByText('Dropped in')).toBeInTheDocument()
    // Nothing is imported until the user confirms.
    expect(useCalendarStore.getState().events).toHaveLength(0)
  })

  it('dismisses the overlay and imports nothing for a non-.ics file', async () => {
    render(<IcsDropZone />)

    const other = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }))
      window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: [other] }))
    })

    expect(screen.queryByText(/drop .ics file/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('ics-import-confirm')).not.toBeInTheDocument()
    })
  })

  it('accepts a file whose name lacks .ics but whose type is text/calendar', async () => {
    render(<IcsDropZone />)

    const typed = new File([ICS], 'calendar-export', { type: 'text/calendar' })
    act(() => {
      window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: [typed] }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-confirm')).toBeInTheDocument()
    })
  })
})
